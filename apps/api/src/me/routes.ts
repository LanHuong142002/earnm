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
      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!existing) throw notSignedIn();
      const user = await prisma.user.update({
        where: { id: userId },
        data: { language: body.language },
        select: profileSelect,
      });
      res.json(user);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
