import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { findForMember, lockProject } from "../projects/access.js";
import { latestRemindWithComments } from "./remindWithComments.js";
import { isFutureOnce, type ReminderRule } from "./occurrences.js";

/** A task holds at most this many reminders. */
export const MAX_REMINDERS_PER_TASK = 5;
/** A reminder goes to at most this many people. */
export const MAX_REMINDER_RECIPIENTS = 20;

// Accepts "Z" and offsets such as "+07:00".
const editedAtSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a real date.");

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const timezoneSchema = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Not an IANA timezone.");

const recipientsSchema = z
  .array(z.uuid())
  .max(MAX_REMINDER_RECIPIENTS * 5)
  .transform((ids) => [...new Set(ids)])
  .pipe(z.array(z.uuid()).min(1).max(MAX_REMINDER_RECIPIENTS));

const scheduleShape = {
  startDate: dateSchema,
  time: timeSchema,
  timezone: timezoneSchema,
  repeat: z.enum(["once", "daily", "weekly", "monthly"]),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  endDate: dateSchema.nullable(),
};

type ScheduleInput = {
  startDate: string;
  time: string;
  timezone: string;
  repeat: "once" | "daily" | "weekly" | "monthly";
  weekdays: number[];
  endDate: string | null;
};

/** Cross-field rules shared by create and by a schedule edit. */
function checkSchedule(s: ScheduleInput, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (new Set(s.weekdays).size !== s.weekdays.length) issue("weekdays", "Weekdays repeat.");
  if (s.repeat === "weekly" && s.weekdays.length === 0) issue("weekdays", "Choose at least one weekday.");
  if (s.repeat !== "weekly" && s.weekdays.length > 0) issue("weekdays", "Only weekly reminders take weekdays.");
  if (s.endDate !== null && s.endDate < s.startDate) issue("endDate", "The end date is before the start date.");
}

const scheduleSchema = z.object(scheduleShape).strict().superRefine(checkSchedule);

const createSchema = z
  .object({ id: z.uuid(), ...scheduleShape, recipientIds: recipientsSchema })
  .strict()
  .superRefine(checkSchedule);

/** One field change from the phone: the new value and when the person made it. */
const change = <T extends z.ZodType>(value: T) =>
  z.object({ value, editedAt: editedAtSchema }).strict();

const patchSchema = z
  .object({ schedule: change(scheduleSchema).optional(), recipients: change(recipientsSchema).optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "At least one field is required.");

const idSchema = z.uuid();

const include = {
  recipients: { select: { userId: true }, orderBy: { userId: "asc" } },
} satisfies Prisma.TaskReminderInclude;
type ReminderRow = Prisma.TaskReminderGetPayload<{ include: typeof include }>;

const day = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);

/** The exact shape the mobile app expects. */
function reminderResponse(r: ReminderRow) {
  return {
    id: r.id,
    taskId: r.taskId,
    startDate: day(r.startDate),
    time: r.time,
    timezone: r.timezone,
    repeat: r.repeat,
    weekdays: r.weekdays,
    endDate: r.endDate ? day(r.endDate) : null,
    recipientIds: r.recipients.map((x) => x.userId),
    createdById: r.createdById,
    changedAt: r.changedAt.toISOString(),
  };
}

function scheduleData(s: ScheduleInput) {
  return {
    startDate: asDate(s.startDate),
    time: s.time,
    timezone: s.timezone,
    repeat: s.repeat,
    weekdays: s.weekdays,
    endDate: s.endDate === null ? null : asDate(s.endDate),
  };
}

function ruleOf(s: ScheduleInput): ReminderRule {
  return { ...s };
}

/** Route params, including the ones merged in from the parent mount. */
function param(req: Request, name: string): string | undefined {
  return (req.params as Record<string, string | undefined>)[name];
}

/** One 404 for every "no such thing for you" case, so the body never reveals which it was. */
function notFound(): AppError {
  return new AppError(404, "not_found", "Project not found.");
}

function invalid(message: string): AppError {
  return new AppError(400, "validation_failed", message);
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type Deps = { prisma: PrismaClient; now: () => Date };

/** `/projects/:projectId/tasks/:taskId/reminders`. */
export function createRemindersRouter(deps: Deps): Router {
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

  async function requireReminder(req: Request, taskId: string) {
    const parsed = idSchema.safeParse(param(req, "reminderId"));
    if (!parsed.success) throw notFound();
    const reminder = await prisma.taskReminder.findFirst({
      where: { id: parsed.data, taskId },
      select: { id: true },
    });
    if (!reminder) throw notFound();
    return reminder.id;
  }

  /** Takes the project lock and re-checks the caller's membership under it. */
  async function lockedMember(tx: Tx, projectId: string, userId: string) {
    if (!(await lockProject(tx, projectId))) throw notFound();
    const member = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw notFound();
  }

  /** Every recipient must be a member of the project right now. */
  async function requireMembers(tx: Tx, projectId: string, userIds: string[]) {
    const count = await tx.projectMember.count({ where: { projectId, userId: { in: userIds } } });
    if (count !== userIds.length) throw invalid("Recipients must be members of the project.");
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
      const rows = await prisma.taskReminder.findMany({
        where: { taskId },
        include,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      res.json({ reminders: rows.map(reminderResponse) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, taskId } = await requireTask(req, userId);
      const { id, recipientIds, ...schedule } = createSchema.parse(req.body);

      const result = await withRetry(() =>
        prisma.$transaction(async (tx) => {
          await lockedMember(tx, projectId, userId);
          if (!(await tx.task.findFirst({ where: { id: taskId, projectId }, select: { id: true } }))) {
            throw notFound();
          }
          const existing = await tx.taskReminder.findUnique({ where: { id }, include });
          if (existing) {
            if (existing.taskId !== taskId) {
              throw new AppError(409, "id_conflict", "That reminder id is already taken.");
            }
            return { status: 200, reminder: existing };
          }
          // Counted under the project lock, so concurrent creates can't pass the limit together.
          if ((await tx.taskReminder.count({ where: { taskId } })) >= MAX_REMINDERS_PER_TASK) {
            throw new AppError(
              409,
              "reminder_limit_reached",
              `A task can hold at most ${MAX_REMINDERS_PER_TASK} reminders.`,
            );
          }
          await requireMembers(tx, projectId, recipientIds);
          const at = now();
          if (!isFutureOnce(ruleOf(schedule), at)) throw invalid("A one-off reminder must be in the future.");
          // The field times start at the epoch so an edit the phone queued after the create wins
          // even though the create reached us later.
          const epoch = new Date(0);
          const reminder = await tx.taskReminder.create({
            data: {
              id,
              taskId,
              ...scheduleData(schedule),
              scheduleEditedAt: epoch,
              recipientsEditedAt: epoch,
              changedAt: at,
              createdById: userId,
              createdAt: at,
              recipients: { create: recipientIds.map((u) => ({ userId: u })) },
            },
            include,
          });
          return { status: 201, reminder };
        }),
      );
      res.status(result.status).json(reminderResponse(result.reminder));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:reminderId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, taskId } = await requireTask(req, userId);
      const reminderId = await requireReminder(req, taskId);
      const fields = patchSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        const current = await tx.taskReminder.findFirst({ where: { id: reminderId, taskId } });
        if (!current) throw notFound(); // deleted meanwhile
        const at = now();

        if (fields.schedule) {
          const next = fields.schedule.value;
          const unchanged =
            day(current.startDate) === next.startDate &&
            current.time === next.time &&
            current.timezone === next.timezone &&
            current.repeat === next.repeat &&
            current.weekdays.join() === next.weekdays.join() &&
            (current.endDate ? day(current.endDate) : null) === next.endDate;
          if (!unchanged && !isFutureOnce(ruleOf(next), at)) {
            throw invalid("A one-off reminder must be in the future.");
          }
        }
        if (fields.recipients) await requireMembers(tx, projectId, fields.recipients.value);

        await applyLastWriteWins(fields, at, async (where, data) => {
          if ("schedule" in data) {
            await tx.taskReminder.updateMany({
              where: { id: reminderId, taskId, ...where },
              data: {
                ...scheduleData(data["schedule"] as ScheduleInput),
                scheduleEditedAt: data["scheduleEditedAt"] as Date,
                changedAt: at,
              },
            });
          } else {
            const { count } = await tx.taskReminder.updateMany({
              where: { id: reminderId, taskId, ...where },
              data: { recipientsEditedAt: data["recipientsEditedAt"] as Date, changedAt: at },
            });
            if (count > 0) {
              await tx.taskReminderRecipient.deleteMany({ where: { reminderId } });
              await tx.taskReminderRecipient.createMany({
                data: (data["recipients"] as string[]).map((u) => ({ reminderId, userId: u })),
              });
            }
          }
        });
      });

      // Always answer with the current state, even when every change lost.
      const current = await prisma.taskReminder.findFirst({ where: { id: reminderId, taskId }, include });
      if (!current) throw notFound(); // deleted meanwhile
      res.json(reminderResponse(current));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:reminderId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, taskId } = await requireTask(req, userId);
      const parsed = idSchema.safeParse(param(req, "reminderId"));
      if (!parsed.success) throw notFound();
      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        const { count } = await tx.taskReminder.deleteMany({ where: { id: parsed.data, taskId } });
        if (count === 0) throw notFound(); // gone already
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** `/projects/:projectId/reminders`: every reminder in the project, with the comments that ride along. */
export function createProjectRemindersRouter(deps: Deps): Router {
  const { prisma } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  router.get("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectId = idSchema.safeParse(param(req, "projectId"));
      if (!projectId.success) throw notFound();
      if (!(await findForMember(prisma, projectId.data, userId))) throw notFound();

      // Bounded: a task has at most 5 reminders, and a project holds at most 1000 tasks (R7), so
      // the list is at most 5 x 1000 reminders and needs no paging.
      const rows = await prisma.taskReminder.findMany({
        where: { task: { projectId: projectId.data } },
        include,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const taskIds = [...new Set(rows.map((r) => r.taskId))];
      const remindWith = Object.fromEntries(await latestRemindWithComments(prisma, taskIds));
      const body = { reminders: rows.map(reminderResponse), remindWith };
      // This phone now has the project's reminders to schedule, so the tick needn't push them.
      const pushToken = req.get("x-push-token");
      if (pushToken) {
        const device = await prisma.devicePushToken.findFirst({ where: { token: pushToken, userId }, select: { token: true } });
        if (device) {
          const at = deps.now();
          await prisma.deviceProjectSync.upsert({
            where: { token_projectId: { token: pushToken, projectId: projectId.data } },
            create: { token: pushToken, projectId: projectId.data, lastSyncedAt: at },
            update: { lastSyncedAt: at },
          });
        }
      }
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
