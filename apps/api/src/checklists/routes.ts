import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { singleLineText } from "../http/text.js";
import { findForMember, lockProject } from "../projects/access.js";

/** A task holds at most this many checklists. */
export const MAX_CHECKLISTS_PER_TASK = 10;
/** A checklist holds at most this many items. */
export const MAX_ITEMS_PER_CHECKLIST = 50;

const nameSchema = singleLineText(60);
const textSchema = singleLineText(200);
// Accepts "Z" and offsets such as "+07:00".
const editedAtSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const createChecklistSchema = z
  .object({ id: z.uuid(), name: nameSchema, editedAt: editedAtSchema })
  .strict();

const createItemSchema = z
  .object({ id: z.uuid(), text: textSchema, editedAt: editedAtSchema })
  .strict();

/** One field change from the phone: the new value and when the person made it. */
const change = <T extends z.ZodType>(value: T) =>
  z.object({ value, editedAt: editedAtSchema }).strict();

const patchChecklistSchema = z
  .object({
    fields: z
      .object({ name: change(nameSchema).optional() })
      .strict()
      .refine((f) => Object.keys(f).length > 0, "At least one field is required."),
  })
  .strict();

const patchItemSchema = z
  .object({
    fields: z
      .object({
        text: change(textSchema).optional(),
        done: change(z.boolean()).optional(),
      })
      .strict()
      .refine((f) => Object.keys(f).length > 0, "At least one field is required."),
  })
  .strict();

const idSchema = z.uuid();

const itemOrder = [{ createdAt: "asc" }, { id: "asc" }] satisfies Prisma.ChecklistItemOrderByWithRelationInput[];
const checklistInclude = {
  items: { orderBy: itemOrder },
} satisfies Prisma.ChecklistInclude;

type ChecklistRow = Prisma.ChecklistGetPayload<{ include: typeof checklistInclude }>;
type ItemRow = Prisma.ChecklistItemGetPayload<object>;

/** The exact shape the mobile app expects. */
function itemResponse(item: ItemRow) {
  return { id: item.id, text: item.text, done: item.done, createdAt: item.createdAt.toISOString() };
}

function checklistResponse(checklist: ChecklistRow) {
  return {
    id: checklist.id,
    name: checklist.name,
    createdAt: checklist.createdAt.toISOString(),
    items: checklist.items.map(itemResponse),
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

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export function createChecklistsRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
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

  /** The checklist on this task, or a 404 that looks the same whether it's missing or elsewhere. */
  async function requireChecklist(req: Request, taskId: string) {
    const parsed = idSchema.safeParse(param(req, "checklistId"));
    if (!parsed.success) throw notFound();
    const checklist = await prisma.checklist.findFirst({
      where: { id: parsed.data, taskId },
      select: { id: true },
    });
    if (!checklist) throw notFound();
    return checklist.id;
  }

  /** The item in this checklist, or the same 404. */
  async function requireItem(req: Request, checklistId: string) {
    const parsed = idSchema.safeParse(param(req, "itemId"));
    if (!parsed.success) throw notFound();
    const item = await prisma.checklistItem.findFirst({
      where: { id: parsed.data, checklistId },
      select: { id: true },
    });
    if (!item) throw notFound();
    return item.id;
  }

  /** Takes the project lock and re-checks the caller's membership under it. */
  async function lockedMember(tx: Tx, projectId: string, userId: string) {
    if (!(await lockProject(tx, projectId))) throw notFound();
    const member = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw notFound();
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

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, taskId } = await requireTask(req, userId);
      const body = createChecklistSchema.parse(req.body);
      // A phone can't set a time in the server's future, or its edits would beat every later one.
      const editedAt = new Date(Math.min(body.editedAt.getTime(), now().getTime()));

      const result = await withRetry(() =>
        prisma.$transaction(async (tx) => {
          await lockedMember(tx, projectId, userId);
          if (!(await tx.task.findFirst({ where: { id: taskId, projectId }, select: { id: true } }))) {
            throw notFound();
          }
          const existing = await tx.checklist.findUnique({
            where: { id: body.id },
            include: checklistInclude,
          });
          if (existing) {
            if (existing.taskId !== taskId) {
              throw new AppError(409, "id_conflict", "That checklist id is already taken.");
            }
            return { status: 200, checklist: existing };
          }
          // Counted under the project lock, so concurrent creates can't pass the limit together.
          if ((await tx.checklist.count({ where: { taskId } })) >= MAX_CHECKLISTS_PER_TASK) {
            throw new AppError(
              409,
              "checklist_limit_reached",
              `A task can hold at most ${MAX_CHECKLISTS_PER_TASK} checklists.`,
            );
          }
          const checklist = await tx.checklist.create({
            data: { id: body.id, taskId, name: body.name, nameEditedAt: editedAt },
            include: checklistInclude,
          });
          return { status: 201, checklist };
        }),
      );
      res.status(result.status).json(checklistResponse(result.checklist));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:checklistId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, taskId } = await requireTask(req, userId);
      const checklistId = await requireChecklist(req, taskId);
      const { fields } = patchChecklistSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        await applyLastWriteWins(fields, now(), async (where, data) => {
          await tx.checklist.updateMany({
            where: { id: checklistId, taskId, ...where },
            data,
          } as Prisma.ChecklistUpdateManyArgs);
        });
      });

      // Always answer with the current state, even when every change lost.
      const current = await prisma.checklist.findFirst({
        where: { id: checklistId, taskId },
        include: checklistInclude,
      });
      if (!current) throw notFound(); // deleted meanwhile
      res.json(checklistResponse(current));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:checklistId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, taskId } = await requireTask(req, userId);
      const checklistId = await requireChecklist(req, taskId);
      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        // The items are removed by the database cascade.
        const { count } = await tx.checklist.deleteMany({ where: { id: checklistId, taskId } });
        if (count === 0) throw notFound(); // someone else deleted it first
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post("/:checklistId/items", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, taskId } = await requireTask(req, userId);
      const checklistId = await requireChecklist(req, taskId);
      const body = createItemSchema.parse(req.body);
      const editedAt = new Date(Math.min(body.editedAt.getTime(), now().getTime()));

      const result = await withRetry(() =>
        prisma.$transaction(async (tx) => {
          await lockedMember(tx, projectId, userId);
          if (!(await tx.checklist.findFirst({ where: { id: checklistId, taskId }, select: { id: true } }))) {
            throw notFound();
          }
          const existing = await tx.checklistItem.findUnique({ where: { id: body.id } });
          if (existing) {
            if (existing.checklistId !== checklistId) {
              throw new AppError(409, "id_conflict", "That item id is already taken.");
            }
            return { status: 200, item: existing };
          }
          if ((await tx.checklistItem.count({ where: { checklistId } })) >= MAX_ITEMS_PER_CHECKLIST) {
            throw new AppError(
              409,
              "item_limit_reached",
              `A checklist can hold at most ${MAX_ITEMS_PER_CHECKLIST} items.`,
            );
          }
          const item = await tx.checklistItem.create({
            data: {
              id: body.id,
              checklistId,
              text: body.text,
              done: false,
              textEditedAt: editedAt,
              doneEditedAt: editedAt,
            },
          });
          return { status: 201, item };
        }),
      );
      res.status(result.status).json(itemResponse(result.item));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:checklistId/items/:itemId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, taskId } = await requireTask(req, userId);
      const checklistId = await requireChecklist(req, taskId);
      const itemId = await requireItem(req, checklistId);
      const { fields } = patchItemSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        await applyLastWriteWins(fields, now(), async (where, data) => {
          await tx.checklistItem.updateMany({
            where: { id: itemId, checklistId, ...where },
            data,
          } as Prisma.ChecklistItemUpdateManyArgs);
        });
      });

      const current = await prisma.checklistItem.findFirst({ where: { id: itemId, checklistId } });
      if (!current) throw notFound(); // deleted meanwhile
      res.json(itemResponse(current));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:checklistId/items/:itemId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, taskId } = await requireTask(req, userId);
      const checklistId = await requireChecklist(req, taskId);
      const itemId = await requireItem(req, checklistId);
      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        const { count } = await tx.checklistItem.deleteMany({ where: { id: itemId, checklistId } });
        if (count === 0) throw notFound(); // someone else deleted it first
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
