import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { multiLineText } from "../http/text.js";
import { findForMember, lockProject } from "../projects/access.js";
import { isInvolved } from "../tasks/involved.js";

/** A task holds at most this many comments. */
export const MAX_COMMENTS_PER_TASK = 500;
/** A comment is at most this many characters after trimming. */
export const MAX_COMMENT_LENGTH = 1000;

const textSchema = multiLineText(MAX_COMMENT_LENGTH).min(1);
// Accepts "Z" and offsets such as "+07:00".
const editedAtSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const createSchema = z
  .object({ id: z.uuid(), text: textSchema, remindWith: z.boolean().optional() })
  .strict();

/** One field change from the phone: the new value and when the person made it. */
const change = <T extends z.ZodType>(value: T) =>
  z.object({ value, editedAt: editedAtSchema }).strict();

const patchSchema = z
  .object({ text: change(textSchema).optional(), remindWith: change(z.boolean()).optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "At least one field is required.");

const idSchema = z.uuid();

const order = [{ createdAt: "asc" }, { id: "asc" }] satisfies Prisma.TaskCommentOrderByWithRelationInput[];
const include = {
  author: { select: { id: true, displayName: true } },
} satisfies Prisma.TaskCommentInclude;
type CommentRow = Prisma.TaskCommentGetPayload<{ include: typeof include }>;

/** The exact shape the mobile app expects. */
function commentResponse(c: CommentRow) {
  return {
    id: c.id,
    taskId: c.taskId,
    author: c.author ? { id: c.author.id, displayName: c.author.displayName } : null,
    text: c.text,
    edited: c.edited,
    remindWith: c.remindWith,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Route params, including the ones merged in from the parent mount. */
function param(req: Request, name: string): string | undefined {
  return (req.params as Record<string, string | undefined>)[name];
}

/** One 404 for every "no such thing for you" case, so the body never reveals which it was. */
function notFound(): AppError {
  return new AppError(404, "not_found", "Project not found.");
}

function forbidden(message: string): AppError {
  return new AppError(403, "forbidden", message);
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export function createCommentsRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
  const { prisma, now } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  /** The caller's membership in `:projectId`, and the task in it. Every miss gives the same 404. */
  async function requireTask(req: Request, userId: string) {
    const projectId = idSchema.safeParse(param(req, "projectId"));
    const taskId = idSchema.safeParse(param(req, "taskId"));
    if (!projectId.success || !taskId.success) throw notFound();
    if (!(await findForMember(prisma, projectId.data, userId))) throw notFound();
    const task = await prisma.task.findFirst({
      where: { id: taskId.data, projectId: projectId.data },
      select: { id: true },
    });
    if (!task) throw notFound();
    return { projectId: projectId.data, taskId: task.id };
  }

  /** The comment on this task, or a 404 that looks the same whether it's missing or elsewhere. */
  async function requireComment(req: Request, taskId: string) {
    const parsed = idSchema.safeParse(param(req, "commentId"));
    if (!parsed.success) throw notFound();
    const comment = await prisma.taskComment.findFirst({
      where: { id: parsed.data, taskId },
      select: { id: true },
    });
    if (!comment) throw notFound();
    return comment.id;
  }

  /** Takes the project lock and re-checks the caller's membership under it. */
  async function lockedMember(tx: Tx, projectId: string, userId: string) {
    if (!(await lockProject(tx, projectId))) throw notFound();
    const member = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw notFound();
  }

  /** The task as it is under the lock, or the same 404. */
  async function lockedTask(tx: Tx, projectId: string, taskId: string) {
    const task = await tx.task.findFirst({
      where: { id: taskId, projectId },
      select: { id: true, createdById: true },
    });
    if (!task) throw notFound();
    return task;
  }

  /** Runs `createOnce`; when an identical create won at the same moment, runs it once more. */
  async function withRetry<T>(createOnce: () => Promise<T>): Promise<T> {
    try {
      return await createOnce();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return createOnce();
    }
  }

  router.get("/", async (req, res, next) => {
    try {
      const { taskId } = await requireTask(req, getAuth(res.locals).userId);
      const rows = await prisma.taskComment.findMany({ where: { taskId }, include, orderBy: order });
      res.json({ comments: rows.map(commentResponse) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, taskId } = await requireTask(req, userId);
      const body = createSchema.parse(req.body);

      const result = await withRetry(() =>
        prisma.$transaction(async (tx) => {
          await lockedMember(tx, projectId, userId);
          const task = await lockedTask(tx, projectId, taskId);
          const existing = await tx.taskComment.findUnique({ where: { id: body.id }, include });
          if (existing) {
            if (existing.taskId !== taskId) {
              throw new AppError(409, "id_conflict", "That comment id is already taken.");
            }
            return { status: 200, comment: existing };
          }
          if (body.remindWith && !(await isInvolved(tx, task, userId))) {
            throw forbidden("Only people involved in the task can set this.");
          }
          // Counted under the project lock, so concurrent creates can't pass the limit together.
          if ((await tx.taskComment.count({ where: { taskId } })) >= MAX_COMMENTS_PER_TASK) {
            throw new AppError(
              409,
              "comment_limit_reached",
              `A task can hold at most ${MAX_COMMENTS_PER_TASK} comments.`,
            );
          }
          // The field times start at the epoch: the create carries no edit time, and an edit the
          // phone queued after writing the comment must win even though the create reached us later.
          const epoch = new Date(0);
          const comment = await tx.taskComment.create({
            data: {
              id: body.id,
              taskId,
              authorId: userId,
              text: body.text,
              remindWith: body.remindWith ?? false,
              textEditedAt: epoch,
              remindWithEditedAt: epoch,
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
      const { projectId, taskId } = await requireTask(req, userId);
      const commentId = await requireComment(req, taskId);
      const fields = patchSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        const comment = await tx.taskComment.findFirst({
          where: { id: commentId, taskId },
          select: { authorId: true },
        });
        if (!comment) throw notFound(); // deleted meanwhile
        if (fields.text && comment.authorId !== userId) {
          throw forbidden("Only the author can edit a comment.");
        }
        if (fields.remindWith) {
          const task = await lockedTask(tx, projectId, taskId);
          if (!(await isInvolved(tx, task, userId))) {
            throw forbidden("Only people involved in the task can set this.");
          }
        }
        await applyLastWriteWins(fields, now(), async (where, data) => {
          await tx.taskComment.updateMany({
            where: { id: commentId, taskId, ...where },
            // A winning text change marks the comment as edited; a flag change never does.
            data: "text" in data ? { ...data, edited: true } : data,
          } as Prisma.TaskCommentUpdateManyArgs);
        });
      });

      // Always answer with the current state, even when every change lost.
      const current = await prisma.taskComment.findFirst({ where: { id: commentId, taskId }, include });
      if (!current) throw notFound(); // deleted meanwhile
      res.json(commentResponse(current));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:commentId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, taskId } = await requireTask(req, userId);
      const commentId = await requireComment(req, taskId);
      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        const comment = await tx.taskComment.findFirst({
          where: { id: commentId, taskId },
          select: { authorId: true },
        });
        if (!comment) throw notFound();
        if (comment.authorId !== userId) throw forbidden("Only the author can delete a comment.");
        const { count } = await tx.taskComment.deleteMany({ where: { id: commentId, taskId } });
        if (count === 0) throw notFound();
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
