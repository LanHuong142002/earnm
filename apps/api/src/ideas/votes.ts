import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { lockedIdea, lockedMember, notFound, requireIdea } from "./common.js";
import { ideaInclude, ideaResponse } from "./response.js";

const voteSchema = z
  .object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) })
  .strict();

/** `PUT /projects/:projectId/ideas/:ideaId/vote`: one vote per member; 0 takes it back. */
export function createVotesRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
  const { prisma } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  router.put("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      const { value } = voteSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        await lockedIdea(tx, projectId, ideaId);
        if (value === 0) {
          await tx.ideaVote.deleteMany({ where: { ideaId, userId } });
        } else {
          await tx.ideaVote.upsert({
            where: { ideaId_userId: { ideaId, userId } },
            create: { ideaId, userId, value },
            update: { value },
          });
        }
      });

      const current = await prisma.idea.findFirst({
        where: { id: ideaId, projectId },
        include: ideaInclude,
      });
      if (!current) throw notFound(); // deleted meanwhile
      res.json(ideaResponse(current, userId));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
