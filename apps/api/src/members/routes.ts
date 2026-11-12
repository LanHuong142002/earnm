import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { findForMember, lockProject } from "../projects/access.js";

const idSchema = z.uuid();
const roleSchema = z.object({ role: z.enum(["owner", "member"]) }).strict();

type Role = "owner" | "member";

/** Express types a path parameter as string or string[]; a named segment is always a string. */
function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function notFound(): AppError {
  return new AppError(404, "not_found", "Project not found.");
}

function lastOwner(): AppError {
  return new AppError(409, "last_owner", "A project needs at least one Owner.");
}

function forbidden(): AppError {
  return new AppError(403, "forbidden", "Only the owner can do this.");
}

function parseProjectId(raw: string | undefined): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

/** A target that is not a uuid cannot be a member, so it is the same 404 as one that isn't in the project. */
function parseTargetId(raw: string | undefined): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(404, "not_found", "Member not found.");
  return parsed.data;
}

interface MemberItem {
  userId: string;
  displayName: string;
  role: Role;
  joinedAt: string;
}

function toItem(m: { userId: string; role: Role; createdAt: Date; user: { displayName: string } }): MemberItem {
  return { userId: m.userId, displayName: m.user.displayName, role: m.role, joinedAt: m.createdAt.toISOString() };
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export function createMembersRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
  const { prisma, now } = deps;
  const router = Router();
  const authenticate = requireAuth(deps);

  /**
   * 404 unless the caller is in the project. Whether they are an Owner is decided inside the
   * transaction, under the lock, so a concurrent change can't make it stale.
   */
  async function requireMember(
    callerId: string,
    rawId: string | undefined,
  ): Promise<{ projectId: string }> {
    const projectId = parseProjectId(rawId);
    const found = await findForMember(prisma, projectId, callerId);
    if (!found) throw notFound();
    return { projectId };
  }

  /**
   * Runs a membership change under the project lock, handing it the Owner count and the
   * caller's current role, both read under the lock. Owner-only changes check the caller's
   * role first (403), then refuse a change that leaves zero Owners (409). A caller who lost
   * their place meanwhile gets 404.
   */
  function change<T>(
    projectId: string,
    callerId: string,
    run: (tx: Tx, ctx: { owners: number; callerRole: Role }) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      if (!(await lockProject(tx, projectId))) throw notFound();
      const caller = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: callerId } },
      });
      if (!caller) throw notFound();
      const owners = await tx.projectMember.count({ where: { projectId, role: "owner" } });
      return run(tx, { owners, callerRole: caller.role });
    });
  }

  router.get("/projects/:id/members", authenticate, async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectId = parseProjectId(param(req.params["id"]));
      if (!(await findForMember(prisma, projectId, userId))) throw notFound();
      const rows = await prisma.projectMember.findMany({
        where: { projectId },
        include: { user: { select: { displayName: true } } },
      });
      rows.sort(
        (a, b) =>
          Number(b.role === "owner") - Number(a.role === "owner") ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
      );
      res.json(rows.map(toItem));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/projects/:id/members/:userId", authenticate, async (req, res, next) => {
    try {
      const callerId = getAuth(res.locals).userId;
      const { projectId } = await requireMember(callerId, param(req.params["id"]));
      const targetId = parseTargetId(param(req.params["userId"]));
      const { role } = roleSchema.parse(req.body);
      const item = await change(projectId, callerId, async (tx, { owners, callerRole }) => {
        if (callerRole !== "owner") throw forbidden();
        const target = await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId, userId: targetId } },
          include: { user: { select: { displayName: true } } },
        });
        if (!target) {
          throw new AppError(404, "not_found", "Member not found.");
        }
        const after = owners - (target.role === "owner" ? 1 : 0) + (role === "owner" ? 1 : 0);
        if (target.role !== role && after === 0) throw lastOwner();
        if (target.role === role) return toItem(target);
        const updated = await tx.projectMember.update({
          where: { projectId_userId: { projectId, userId: targetId } },
          data: { role },
          include: { user: { select: { displayName: true } } },
        });
        return toItem(updated);
      });
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  router.delete("/projects/:id/members/:userId", authenticate, async (req, res, next) => {
    try {
      const callerId = getAuth(res.locals).userId;
      const { projectId } = await requireMember(callerId, param(req.params["id"]));
      const targetId = parseTargetId(param(req.params["userId"]));
      if (targetId === callerId) {
        throw new AppError(400, "validation_failed", "You can't remove yourself. Leave the project instead.");
      }
      await change(projectId, callerId, async (tx, { owners, callerRole }) => {
        if (callerRole !== "owner") throw forbidden();
        const target = await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId, userId: targetId } },
        });
        if (!target) {
          throw new AppError(404, "not_found", "Member not found.");
        }
        if (target.role === "owner" && owners - 1 === 0) throw lastOwner();
        await tx.projectMember.delete({ where: { projectId_userId: { projectId, userId: targetId } } });
        // The removed user saw the plain codes of their invites; they must not outlive them.
        const at = now();
        await tx.invite.updateMany({
          where: { projectId, createdById: targetId, usedAt: null, revokedAt: null, expiresAt: { gt: at } },
          data: { revokedAt: at },
        });
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post("/projects/:id/leave", authenticate, async (req, res, next) => {
    try {
      const callerId = getAuth(res.locals).userId;
      const projectId = parseProjectId(param(req.params["id"]));
      await change(projectId, callerId, async (tx, { owners, callerRole }) => {
        if (callerRole === "owner" && owners - 1 === 0) throw lastOwner();
        await tx.projectMember.delete({ where: { projectId_userId: { projectId, userId: callerId } } });
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
