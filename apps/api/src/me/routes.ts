import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";

const profileSelect = {
  id: true,
  email: true,
  displayName: true,
  language: true,
} as const;

const patchSchema = z.object({ language: z.enum(["vi", "en"]) }).strict();

const tokenSchema = z.object({ token: z.string().min(1).max(200) }).strict();
/** One person's devices; registering past this drops the oldest. */
const MAX_TOKENS_PER_USER = 10;

function notSignedIn(): AppError {
  return new AppError(401, "not_signed_in", "Not signed in.");
}

export function createMeRouter(deps: {
  prisma: PrismaClient;
  now: () => Date;
}): Router {
  const { prisma } = deps;
  const router = Router();
  router.use(requireAuth(deps));

  router.get("/", async (_req, res, next) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: getAuth(res.locals).userId },
        select: profileSelect,
      });
      if (!user) throw notSignedIn();
      res.json(user);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/", async (req, res, next) => {
    try {
      const body = patchSchema.parse(req.body);
      const userId = getAuth(res.locals).userId;
      const { count } = await prisma.user.updateMany({
        where: { id: userId },
        data: { language: body.language },
      });
      if (count === 0) throw notSignedIn();
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: profileSelect,
      });
      if (!user) throw notSignedIn();
      res.json(user);
    } catch (err) {
      next(err);
    }
  });

  // Tokens are personal data: written here, read only by the tick, never sent to anyone.
  router.put("/push-token", async (req, res, next) => {
    try {
      const { token } = tokenSchema.parse(req.body);
      const userId = getAuth(res.locals).userId;
      await prisma.$transaction(async (tx) => {
        const existing = await tx.devicePushToken.findUnique({ where: { token } });
        if (!existing) {
          await tx.devicePushToken.create({ data: { token, userId } });
        } else if (existing.userId !== userId) {
          // A moved token starts over: the new owner's phone has not synced yet.
          await tx.deviceProjectSync.deleteMany({ where: { token } });
          await tx.devicePushToken.update({
            where: { token },
            data: { userId, lastSyncedAt: null, createdAt: deps.now() },
          });
        } else {
          // Registering again makes this the newest device, so the cap never drops it.
          await tx.devicePushToken.update({ where: { token }, data: { createdAt: deps.now() } });
        }
        const newest = await tx.devicePushToken.findMany({
          where: { userId },
          orderBy: [{ createdAt: "desc" }, { token: "asc" }],
          select: { token: true },
          skip: MAX_TOKENS_PER_USER,
        });
        if (newest.length > 0) {
          await tx.devicePushToken.deleteMany({ where: { token: { in: newest.map((t) => t.token) } } });
        }
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.delete("/push-token", async (req, res, next) => {
    try {
      const { token } = tokenSchema.parse(req.body);
      await prisma.devicePushToken.deleteMany({ where: { token, userId: getAuth(res.locals).userId } });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
