import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { findForMember } from "../projects/access.js";

/** Items per feed page. */
export const FEED_PAGE_SIZE = 30;
/** The feed and the unread dot only look this far back. */
export const FEED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const TYPES = ["assigned", "comment", "done", "idea", "member_joined"] as const;
type ActivityTypeName = (typeof TYPES)[number];

const typeSchema = z.enum(TYPES);
const enabledSchema = z.object({ enabled: z.boolean() }).strict();
const mutedSchema = z.object({ muted: z.boolean() }).strict();
const readSchema = z.object({ eventIds: z.array(z.uuid()).min(1).max(100) }).strict();
const idSchema = z.uuid();

function notFound(): AppError {
  return new AppError(404, "not_found", "Project not found.");
}

function invalidCursor(): AppError {
  return new AppError(400, "validation_failed", "The cursor is not valid.");
}

function encodeCursor(occurredAt: Date, eventId: string): string {
  return Buffer.from(`${occurredAt.toISOString()}|${eventId}`, "utf8").toString("base64url");
}

function decodeCursor(raw: unknown): { occurredAt: Date; eventId: string } | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) throw invalidCursor();
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw invalidCursor();
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const [iso, eventId, ...rest] = text.split("|");
  if (rest.length > 0 || iso === undefined || eventId === undefined) throw invalidCursor();
  const occurredAt = new Date(iso);
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== iso) throw invalidCursor();
  if (!idSchema.safeParse(eventId).success) throw invalidCursor();
  return { occurredAt, eventId };
}

async function loadSettings(prisma: PrismaClient, userId: string) {
  const [typeMutes, projectMutes] = await Promise.all([
    prisma.notificationTypeMute.findMany({ where: { userId }, select: { type: true } }),
    // Only projects the caller is still in.
    prisma.projectNotificationMute.findMany({
      where: { userId, project: { members: { some: { userId } } } },
      select: { projectId: true },
      orderBy: { projectId: "asc" },
    }),
  ]);
  const muted = new Set<string>(typeMutes.map((m) => m.type));
  const types = Object.fromEntries(TYPES.map((t) => [t, !muted.has(t)])) as Record<ActivityTypeName, boolean>;
  return { types, mutedProjectIds: projectMutes.map((m) => m.projectId) };
}

/**
 * Notification settings and the activity feed. Every query is scoped to the signed-in user, and
 * an event that isn't theirs is indistinguishable from one that doesn't exist.
 * Mounted before the routers that require sign-in on whole prefixes, so it checks sign-in per route.
 */
export function createActivityRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
  const router = Router();
  const { prisma } = deps;
  const auth = requireAuth(deps);

  /** What the feed and the dot may show: the caller's own rows, recent, in projects they are in. */
  const visible = (userId: string) => ({
    userId,
    occurredAt: { gte: new Date(deps.now().getTime() - FEED_WINDOW_MS) },
    event: { project: { members: { some: { userId } } } },
  });

  router.get("/me/notification-settings", auth, async (_req, res, next) => {
    try {
      res.json(await loadSettings(prisma, getAuth(res.locals).userId));
    } catch (err) {
      next(err);
    }
  });

  router.put("/me/notification-settings/types/:type", auth, async (req, res, next) => {
    try {
      const { userId } = getAuth(res.locals);
      const type = typeSchema.parse(req.params["type"]);
      const { enabled } = enabledSchema.parse(req.body);
      if (enabled) {
        await prisma.notificationTypeMute.deleteMany({ where: { userId, type } });
      } else {
        // skipDuplicates: a repeated or concurrent request is a no-op, never a unique violation.
        await prisma.notificationTypeMute.createMany({ data: [{ userId, type }], skipDuplicates: true });
      }
      res.json(await loadSettings(prisma, userId));
    } catch (err) {
      next(err);
    }
  });

  router.put("/projects/:projectId/notification-mute", auth, async (req, res, next) => {
    try {
      const { userId } = getAuth(res.locals);
      const projectId = idSchema.safeParse(req.params["projectId"]);
      if (!projectId.success) throw notFound();
      const { muted } = mutedSchema.parse(req.body);
      if (!(await findForMember(prisma, projectId.data, userId))) throw notFound();
      if (muted) {
        await prisma.projectNotificationMute.createMany({
          data: [{ userId, projectId: projectId.data }],
          skipDuplicates: true,
        });
      } else {
        await prisma.projectNotificationMute.deleteMany({ where: { userId, projectId: projectId.data } });
      }
      res.json({ muted });
    } catch (err) {
      next(err);
    }
  });

  router.get("/me/activity", auth, async (req, res, next) => {
    try {
      const { userId } = getAuth(res.locals);
      const cursor = decodeCursor(req.query["cursor"]);
      const base = visible(userId);
      const rows = await prisma.activityRecipient.findMany({
        where: cursor
          ? {
              ...base,
              OR: [
                { occurredAt: { lt: cursor.occurredAt } },
                { occurredAt: cursor.occurredAt, eventId: { lt: cursor.eventId } },
              ],
            }
          : base,
        orderBy: [{ occurredAt: "desc" }, { eventId: "desc" }],
        take: FEED_PAGE_SIZE + 1,
        include: {
          event: {
            include: {
              project: { select: { name: true } },
              actor: { select: { displayName: true } },
              member: { select: { displayName: true } },
            },
          },
        },
      });
      const page = rows.slice(0, FEED_PAGE_SIZE);
      const last = page[page.length - 1];
      res.json({
        items: page.map((r) => ({
          id: r.eventId,
          type: r.event.type,
          actorName: r.event.actor?.displayName ?? null,
          subjectTitle: r.event.subjectTitle,
          projectId: r.event.projectId,
          projectName: r.event.project.name,
          taskId: r.event.taskId,
          ideaId: r.event.ideaId,
          memberId: r.event.memberId,
          memberName: r.event.member?.displayName ?? null,
          occurredAt: r.occurredAt.toISOString(),
          read: r.readAt !== null,
        })),
        nextCursor: rows.length > FEED_PAGE_SIZE && last ? encodeCursor(last.occurredAt, last.eventId) : null,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/me/activity/unread", auth, async (_req, res, next) => {
    try {
      const { userId } = getAuth(res.locals);
      const found = await prisma.activityRecipient.findFirst({
        where: { ...visible(userId), readAt: null },
        select: { eventId: true },
      });
      res.json({ hasUnread: found !== null });
    } catch (err) {
      next(err);
    }
  });

  router.post("/me/activity/read", auth, async (req, res, next) => {
    try {
      const { userId } = getAuth(res.locals);
      const { eventIds } = readSchema.parse(req.body);
      // Scoped to the caller's own rows: other ids change nothing and the answer is the same.
      await prisma.activityRecipient.updateMany({
        where: { userId, eventId: { in: eventIds }, readAt: null },
        data: { readAt: deps.now() },
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post("/me/activity/read-all", auth, async (_req, res, next) => {
    try {
      const { userId } = getAuth(res.locals);
      await prisma.activityRecipient.updateMany({
        where: { userId, readAt: null },
        data: { readAt: deps.now() },
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
