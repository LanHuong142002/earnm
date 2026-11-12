import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { createSignInLimiter, type AttemptHandle } from "../auth/rate-limit.js";
import { AppError } from "../http/errors.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { lockProject, requireOwner } from "../projects/access.js";
import { toResponse } from "../projects/routes.js";
import { formatCode, generateCode as realGenerateCode, hashCode, normalizeCode } from "./code.js";

export const INVITE_LIFETIME_MS = 7 * 24 * 3600 * 1000;
export const MAX_PENDING_INVITES = 20;
export const MAX_MEMBERS = 50;
/** Tries to find an unused code before giving up. */
const CODE_ATTEMPTS = 3;
/** Join attempts per account and per IP in a 15 minute window. */
const JOIN_ACCOUNT_LIMIT = 10;
const JOIN_IP_LIMIT = 30;

const createSchema = z.object({}).strict();
const joinSchema = z.object({ code: z.string().max(100) }).strict();
const idSchema = z.uuid();

/** Express types a path parameter as string or string[]; a named segment is always a string. */
function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function invalidInvite(): AppError {
  return new AppError(404, "invalid_invite", "This invite is not valid.");
}

function notFound(): AppError {
  return new AppError(404, "not_found", "Project not found.");
}

export function createInvitesRouter(deps: {
  prisma: PrismaClient;
  now: () => Date;
  inviteKey: Buffer;
  generateCode?: () => string;
}): Router {
  const { prisma, now, inviteKey } = deps;
  const generateCode = deps.generateCode ?? realGenerateCode;
  const router = Router();
  const authenticate = requireAuth(deps);
  // The account id goes in the "email" slot; the pair dimension is not used.
  const joinLimiter = createSignInLimiter({
    now,
    pairLimit: Infinity,
    emailLimit: JOIN_ACCOUNT_LIMIT,
    ipLimit: JOIN_IP_LIMIT,
  });

  router.post("/projects/:id/invites", authenticate, async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectId = await requireOwner(prisma, param(req.params["id"]), userId);
      createSchema.parse(req.body ?? {});
      let code = "";
      let invite;
      for (let attempt = 1; ; attempt++) {
        code = generateCode();
        try {
          invite = await prisma.$transaction(async (tx) => {
            if (!(await lockProject(tx, projectId))) throw notFound();
            // The caller may have been demoted or removed since the check above.
            await requireOwner(tx, projectId, userId);
            const at = now();
            const pending = await tx.invite.count({
              where: { projectId, usedAt: null, revokedAt: null, expiresAt: { gt: at } },
            });
            if (pending >= MAX_PENDING_INVITES) {
              throw new AppError(409, "too_many_invites", "This project has too many pending invites.");
            }
            return tx.invite.create({
              data: {
                projectId,
                codeHash: hashCode(code, inviteKey),
                createdById: userId,
                createdAt: at,
                expiresAt: new Date(at.getTime() + INVITE_LIFETIME_MS),
              },
            });
          });
          break;
        } catch (err) {
          // A taken code hash: draw a fresh code, a few times at most.
          if (!isUniqueViolation(err) || attempt >= CODE_ATTEMPTS) throw err;
        }
      }
      res.status(201).json({
        id: invite.id,
        code: formatCode(code),
        expiresAt: invite.expiresAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:id/invites", authenticate, async (req, res, next) => {
    try {
      const projectId = await requireOwner(prisma, param(req.params["id"]), getAuth(res.locals).userId);
      const invites = await prisma.invite.findMany({
        where: { projectId, usedAt: null, revokedAt: null, expiresAt: { gt: now() } },
        include: { createdBy: { select: { displayName: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: MAX_PENDING_INVITES,
      });
      res.json(
        invites.map((i) => ({
          id: i.id,
          createdBy: i.createdBy ? { displayName: i.createdBy.displayName } : null,
          createdAt: i.createdAt.toISOString(),
          expiresAt: i.expiresAt.toISOString(),
        })),
      );
    } catch (err) {
      next(err);
    }
  });

  router.delete("/projects/:id/invites/:inviteId", authenticate, async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectId = await requireOwner(prisma, param(req.params["id"]), userId);
      const inviteId = idSchema.safeParse(param(req.params["inviteId"]));
      if (!inviteId.success) throw notFound();
      await prisma.$transaction(async (tx) => {
        if (!(await lockProject(tx, projectId))) throw notFound();
        // The caller may have been demoted or removed since the check above.
        await requireOwner(tx, projectId, userId);
        const invite = await tx.invite.findUnique({ where: { id: inviteId.data } });
        if (!invite || invite.projectId !== projectId) throw notFound();
        // Only a pending invite changes; a used, revoked or expired one stays as it is.
        const at = now();
        await tx.invite.updateMany({
          where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: at } },
          data: { revokedAt: at },
        });
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post("/invites/join", authenticate, async (req, res, next) => {
    let handle: AttemptHandle | null = null;
    try {
      const userId = getAuth(res.locals).userId;
      const { code: rawCode } = joinSchema.parse(req.body);
      // Reserve before any code lookup so parallel guesses can't all pass the check.
      handle = joinLimiter.tryAcquire({ email: userId, ip: req.ip ?? "unknown" });
      if (!handle) {
        throw new AppError(429, "too_many_attempts", "Too many attempts. Try again later.");
      }
      try {
        const code = normalizeCode(rawCode);
        if (!code) throw invalidInvite();
        const invite = await prisma.invite.findUnique({
          where: { codeHash: hashCode(code, inviteKey) },
        });
        if (!invite) throw invalidInvite();

        const joined = await prisma.$transaction(async (tx) => {
          if (!(await lockProject(tx, invite.projectId))) throw invalidInvite();
          // Re-read under the lock: a dead code must give one error, whoever enters it.
          const current = await tx.invite.findUnique({ where: { id: invite.id } });
          if (
            !current ||
            current.usedAt !== null ||
            current.revokedAt !== null ||
            current.expiresAt.getTime() <= now().getTime()
          ) {
            throw invalidInvite();
          }
          const existing = await tx.projectMember.findUnique({
            where: { projectId_userId: { projectId: invite.projectId, userId } },
          });
          if (existing) throw new AppError(409, "already_member", "You are already in this project.");
          const members = await tx.projectMember.count({ where: { projectId: invite.projectId } });
          if (members >= MAX_MEMBERS) {
            throw new AppError(409, "project_full", "This project is full.");
          }
          const at = now();
          const { count } = await tx.invite.updateMany({
            where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: at } },
            data: { usedAt: at, usedById: userId },
          });
          if (count === 0) throw invalidInvite();
          await tx.projectMember.create({
            data: { projectId: invite.projectId, userId, role: "member" },
          });
          return tx.project.findUniqueOrThrow({ where: { id: invite.projectId } });
        });
        res.status(200).json(toResponse(joined, "member"));
      } catch (err) {
        if (err instanceof AppError) joinLimiter.fail(handle);
        throw err;
      }
    } catch (err) {
      next(err);
    } finally {
      // No-op after fail(); frees the slot on success or an unexpected error.
      if (handle) joinLimiter.release(handle);
    }
  });

  return router;
}
