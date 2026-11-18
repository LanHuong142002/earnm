import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { multiLineText } from "../http/text.js";
import { change, forbidden, idSchema, lockedIdea, lockedMember, notFound, param, requireIdea, withRetry } from "./common.js";

/** An idea holds at most this many comments. */
export const MAX_COMMENTS_PER_IDEA = 500;
/** A comment is at most this many characters after trimming. */
export const MAX_COMMENT_LENGTH = 1000;

const textSchema = multiLineText(MAX_COMMENT_LENGTH).min(1);

const createSchema = z.object({ id: z.uuid(), text: textSchema }).strict();

const patchSchema = z
  .object({ text: change(textSchema).optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "At least one field is required.");

const order = [{ createdAt: "asc" }, { id: "asc" }] satisfies Prisma.IdeaCommentOrderByWithRelationInput[];
const include = {
  author: { select: { id: true, displayName: true } },
} satisfies Prisma.IdeaCommentInclude;
type CommentRow = Prisma.IdeaCommentGetPayload<{ include: typeof include }>;

/** The exact shape the mobile app expects. There is no remind-with flag on an idea. */
function commentResponse(c: CommentRow) {
  return {
    id: c.id,
    ideaId: c.ideaId,
    author: c.author ? { id: c.author.id, displayName: c.author.displayName } : null,
    text: c.text,
    edited: c.edited,
    createdAt: c.createdAt.toISOString(),
  };
}

export function createIdeaCommentsRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
  const { prisma, now } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  /** The comment on this idea, or a 404 that looks the same whether it's missing or elsewhere. */
  async function requireComment(req: Request, ideaId: string) {
    const parsed = idSchema.safeParse(param(req, "commentId"));
    if (!parsed.success) throw notFound();
    const comment = await prisma.ideaComment.findFirst({
      where: { id: parsed.data, ideaId },
      select: { id: true },
    });
    if (!comment) throw notFound();
    return comment.id;
  }

  router.get("/", async (req, res, next) => {
    try {
      const { ideaId } = await requireIdea(prisma, req, getAuth(res.locals).userId);
      const rows = await prisma.ideaComment.findMany({ where: { ideaId }, include, orderBy: order });
      res.json({ comments: rows.map(commentResponse) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      const body = createSchema.parse(req.body);

      const result = await withRetry(() =>
        prisma.$transaction(async (tx) => {
          await lockedMember(tx, projectId, userId);
          await lockedIdea(tx, projectId, ideaId);
          const existing = await tx.ideaComment.findUnique({ where: { id: body.id }, include });
          if (existing) {
            if (existing.ideaId !== ideaId) {
              throw new AppError(409, "id_conflict", "That comment id is already taken.");
            }
            return { status: 200, comment: existing };
          }
          // Counted under the project lock, so concurrent creates can't pass the limit together.
          if ((await tx.ideaComment.count({ where: { ideaId } })) >= MAX_COMMENTS_PER_IDEA) {
            throw new AppError(
              409,
              "comment_limit_reached",
              `An idea can hold at most ${MAX_COMMENTS_PER_IDEA} comments.`,
            );
          }
          // The text time starts at the epoch: an edit the phone queued after writing the comment
          // must win even though the create reached us later.
          const comment = await tx.ideaComment.create({
            data: {
              id: body.id,
              ideaId,
              authorId: userId,
              text: body.text,
              textEditedAt: new Date(0),
              createdAt: now(),
            },
            include,
          });
          return { status: 201, comment };
        }),
      );
      res.status(result.status).json(commentResponse(result.comment));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:commentId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      const commentId = await requireComment(req, ideaId);
      const fields = patchSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        const comment = await tx.ideaComment.findFirst({
          where: { id: commentId, ideaId },
          select: { authorId: true },
        });
        if (!comment) throw notFound(); // deleted meanwhile
        if (comment.authorId !== userId) throw forbidden("Only the author can edit a comment.");
        await applyLastWriteWins(fields, now(), async (where, data) => {
          await tx.ideaComment.updateMany({
            where: { id: commentId, ideaId, ...where },
            // A winning text change marks the comment as edited.
            data: { ...data, edited: true },
          } as Prisma.IdeaCommentUpdateManyArgs);
        });
      });

      // Always answer with the current state, even when the change lost.
      const current = await prisma.ideaComment.findFirst({ where: { id: commentId, ideaId }, include });
      if (!current) throw notFound(); // deleted meanwhile
      res.json(commentResponse(current));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:commentId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      const commentId = await requireComment(req, ideaId);
      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        const comment = await tx.ideaComment.findFirst({
          where: { id: commentId, ideaId },
          select: { authorId: true },
        });
        if (!comment) throw notFound();
        if (comment.authorId !== userId) throw forbidden("Only the author can delete a comment.");
        const { count } = await tx.ideaComment.deleteMany({ where: { id: commentId, ideaId } });
        if (count === 0) throw notFound();
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
