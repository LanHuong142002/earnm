import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { findForMember } from "../projects/routes.js";

const titleSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().trim().max(2000);
const statusSchema = z.enum(["todo", "doing", "done"]);
// Accepts "Z" and offsets such as "+07:00".
const editedAtSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** "YYYY-MM-DD" naming a real calendar day, parsed as UTC midnight (the column is a plain date). */
const realDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  // Compares the round trip so "2026-02-30" is refused rather than rolled into March.
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    // An impossible month or day gives an Invalid Date, which toISOString would throw on.
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  })
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

const assigneeIdsSchema = z
  .array(z.uuid())
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, "Each person can be listed once.");

const dueValueSchema = z
  .object({ date: realDate, time: timeSchema.nullable().default(null) })
  .strict()
  .nullable();

const createSchema = z
  .object({
    id: z.uuid(),
    title: titleSchema,
    description: descriptionSchema.default(""),
    status: statusSchema.default("todo"),
    dueDate: realDate.nullable().default(null),
    dueTime: timeSchema.nullable().default(null),
    assigneeIds: assigneeIdsSchema.default([]),
    editedAt: editedAtSchema,
  })
  .strict()
  .refine((b) => b.dueTime === null || b.dueDate !== null, {
    message: "A time needs a day.",
    path: ["dueTime"],
  });

/** One field change from the phone: the new value and when the person made it. */
const change = <T extends z.ZodType>(value: T) =>
  z.object({ value, editedAt: editedAtSchema }).strict();

const patchSchema = z
  .object({
    fields: z
      .object({
        title: change(titleSchema).optional(),
        description: change(descriptionSchema).optional(),
        status: change(statusSchema).optional(),
        due: change(dueValueSchema).optional(),
        assignees: change(assigneeIdsSchema).optional(),
      })
      .strict()
      .refine((f) => Object.keys(f).length > 0, "At least one field is required."),
  })
  .strict();

const idSchema = z.uuid();

const taskInclude = {
  assignees: {
    include: { user: { select: { id: true, displayName: true } } },
    orderBy: [{ user: { displayName: "asc" } }, { userId: "asc" }],
  },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/** The exact shape the mobile app expects. */
function toResponse(task: TaskRow) {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
    dueTime: task.dueTime,
    assignees: task.assignees.map((a) => ({ id: a.user.id, displayName: a.user.displayName })),
    createdById: task.createdById,
    createdAt: task.createdAt.toISOString(),
  };
}

/** Route params, including the `:projectId` merged in from the parent mount. */
function param(req: Request, name: string): string | undefined {
  return (req.params as Record<string, string | undefined>)[name];
}

/** One 404 for every "no such thing for you" case, so the body never reveals which it was (R9). */
function notFound(): AppError {
  return new AppError(404, "not_found", "Not found.");
}

export function createTasksRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
  const { prisma, now } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  /** The caller's role in `:projectId`. A bad id, a missing project and a non-member all give one 404. */
  async function requireMember(rawProjectId: string | undefined, userId: string) {
    const parsed = idSchema.safeParse(rawProjectId);
    if (!parsed.success) throw notFound();
    const found = await findForMember(prisma, parsed.data, userId);
    if (!found) throw notFound();
    return { projectId: parsed.data, role: found.role };
  }

  /** The task in this project, or a 404 that looks the same whether it's missing or elsewhere. */
  async function requireTask(rawTaskId: string | undefined, projectId: string) {
    const parsed = idSchema.safeParse(rawTaskId);
    if (!parsed.success) throw notFound();
    const task = await prisma.task.findFirst({
      where: { id: parsed.data, projectId },
      include: taskInclude,
    });
    if (!task) throw notFound();
    return task;
  }

  /** Throws 400 unless every id is a member of the project. Run inside the write's transaction. */
  async function assertAssigneesAreMembers(
    tx: Pick<PrismaClient, "projectMember">,
    projectId: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    const count = await tx.projectMember.count({
      where: { projectId, userId: { in: userIds } },
    });
    if (count !== userIds.length) {
      throw new AppError(400, "validation_failed", "Invalid fields: assignees.");
    }
  }

  router.get("/", async (req, res, next) => {
    try {
      const { projectId } = await requireMember(param(req, "projectId"), getAuth(res.locals).userId);
      const tasks = await prisma.task.findMany({
        where: { projectId },
        include: taskInclude,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      res.json(tasks.map(toResponse));
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId } = await requireMember(param(req, "projectId"), userId);
      const body = createSchema.parse(req.body);
      // A phone can't set a time in the server's future, or its edits would beat every later one.
      const editedAt = new Date(Math.min(body.editedAt.getTime(), now().getTime()));

      const createOnce = () =>
        prisma.$transaction(async (tx) => {
          const existing = await tx.task.findUnique({
            where: { id: body.id },
            include: taskInclude,
          });
          if (existing) {
            if (existing.projectId !== projectId) {
              throw new AppError(409, "id_conflict", "That task id is already taken.");
            }
            return { status: 200, task: existing };
          }
          await assertAssigneesAreMembers(tx, projectId, body.assigneeIds);
          const task = await tx.task.create({
            data: {
              id: body.id,
              projectId,
              title: body.title,
              description: body.description,
              status: body.status,
              dueDate: body.dueDate,
              dueTime: body.dueTime,
              titleEditedAt: editedAt,
              descriptionEditedAt: editedAt,
              statusEditedAt: editedAt,
              dueEditedAt: editedAt,
              assigneesEditedAt: editedAt,
              createdById: userId,
              assignees: { create: body.assigneeIds.map((id) => ({ userId: id })) },
            },
            include: taskInclude,
          });
          return { status: 201, task };
        });

      let result;
      try {
        result = await createOnce();
      } catch (err) {
        // An identical create ran at the same moment and won. Run again: the task
        // now exists, so this returns 200 (same project) or 409 (another one).
        if (!isUniqueViolation(err)) throw err;
        result = await createOnce();
      }
      res.status(result.status).json(toResponse(result.task));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:taskId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId } = await requireMember(param(req, "projectId"), userId);
      const { id: taskId } = await requireTask(param(req, "taskId"), projectId);
      const { fields } = patchSchema.parse(req.body);

      // Last write wins per field, all in one transaction. The column names come from the
      // field names, so TypeScript can't check them here; the route tests do.
      await prisma.$transaction((tx) =>
        applyLastWriteWins(fields, now(), async (where, data) => {
          const scope = { id: taskId, projectId, ...where };
          if ("due" in data) {
            // The day and the time are one field: both are written, or neither.
            const due = data["due"] as { date: Date; time: string | null } | null;
            await tx.task.updateMany({
              where: scope,
              data: {
                dueDate: due ? due.date : null,
                dueTime: due ? due.time : null,
                dueEditedAt: data["dueEditedAt"] as Date,
              },
            });
            return;
          }
          if ("assignees" in data) {
            // Claim the field's time first. Only the request that wins replaces the rows.
            const claimed = await tx.task.updateMany({
              where: scope,
              data: { assigneesEditedAt: data["assigneesEditedAt"] as Date },
            });
            if (claimed.count !== 1) return;
            const ids = data["assignees"] as string[];
            await assertAssigneesAreMembers(tx, projectId, ids);
            await tx.taskAssignee.deleteMany({ where: { taskId } });
            await tx.taskAssignee.createMany({
              data: ids.map((id) => ({ taskId, userId: id })),
            });
            return;
          }
          await tx.task.updateMany({ where: scope, data } as Prisma.TaskUpdateManyArgs);
        }),
      );

      // Always answer with the current state, even when every change lost.
      const current = await prisma.task.findFirst({
        where: { id: taskId, projectId },
        include: taskInclude,
      });
      if (!current) throw notFound(); // deleted meanwhile
      res.json(toResponse(current));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:taskId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, role } = await requireMember(param(req, "projectId"), userId);
      const task = await requireTask(param(req, "taskId"), projectId);
      // A task whose creator was removed (createdById null) can be deleted by an Owner only.
      if (task.createdById !== userId && role !== "owner") {
        throw new AppError(403, "forbidden", "Only the person who created this task or an owner can delete it.");
      }
      // Assignments are removed by the database cascade.
      const { count } = await prisma.task.deleteMany({ where: { id: task.id, projectId } });
      if (count === 0) throw notFound(); // someone else deleted it first
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
