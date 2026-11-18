import type { ApiError } from "../../lib/api";
import type { Change, EntityHandlers, NewChange, Queue } from "../../sync/queue";
import { REMINDER_ENTITY } from "../entities";
import { reasonFor, type TaskRejectedNotice } from "../outcomes";
import { createReminder, deleteReminder, patchReminder, type ReminderFieldPatch } from "./api";
import type { ReminderSchedule } from "./types";

type Deps = {
  createReminder: typeof createReminder;
  patchReminder: typeof patchReminder;
  deleteReminder: typeof deleteReminder;
};

const realDeps: Deps = { createReminder, patchReminder, deleteReminder };

const timeOf = (change: Change, field: string) => change.fieldTimes[field] ?? change.createdAt;

type Where = { projectId: string; taskId: string };

/**
 * Queued reminder changes (see `ReminderChangeData`). The schedule and the recipients are separate fields of an
 * update, each with its own time, so changes made on two phones merge per field and quick edits of one reminder
 * leave one request.
 */
export function reminderCreateChange(input: Where & { id: string; schedule: ReminderSchedule; recipients: string[]; now: Date }): NewChange {
  const at = input.now.toISOString();
  return {
    entity: REMINDER_ENTITY,
    entityId: input.id,
    kind: "create",
    data: { projectId: input.projectId, taskId: input.taskId, schedule: input.schedule, recipients: input.recipients },
    fieldTimes: { schedule: at, recipients: at },
  };
}

export function reminderScheduleChange(input: Where & { id: string; schedule: ReminderSchedule; now: Date }): NewChange {
  return {
    entity: REMINDER_ENTITY,
    entityId: input.id,
    kind: "update",
    data: { projectId: input.projectId, taskId: input.taskId, schedule: input.schedule },
    fieldTimes: { schedule: input.now.toISOString() },
  };
}

export function reminderRecipientsChange(input: Where & { id: string; recipients: string[]; now: Date }): NewChange {
  return {
    entity: REMINDER_ENTITY,
    entityId: input.id,
    kind: "update",
    data: { projectId: input.projectId, taskId: input.taskId, recipients: input.recipients },
    fieldTimes: { recipients: input.now.toISOString() },
  };
}

export function reminderDeleteChange(input: Where & { id: string }): NewChange {
  return { entity: REMINDER_ENTITY, entityId: input.id, kind: "delete", data: { projectId: input.projectId, taskId: input.taskId }, fieldTimes: {} };
}

/** What the sync cycle does when the server refuses a reminder change for good: show this notice, then fetch the project again. */
export type ReminderRejectedOutcome = { notice: TaskRejectedNotice; refreshProjectId: string };

export function reminderRejectedOutcome(change: Change, error: ApiError, taskTitle: string | null): ReminderRejectedOutcome {
  return {
    notice: { kind: change.kind, taskTitle, reason: reasonFor(error), subject: "reminder" },
    refreshProjectId: String(change.data.projectId),
  };
}

/**
 * Registers reminders with the shared queue. The queue folds an edit into a waiting create and a delete into a
 * waiting create (nothing is sent). Results go to `handlers` (the task sync cycle's), so a refusal shows the same
 * rejected-change notice as a task.
 */
export function registerReminderEntity(queue: Queue, handlers: EntityHandlers, deps: Deps = realDeps): void {
  queue.registerEntity(
    REMINDER_ENTITY,
    {
      create: (change, token) => {
        const schedule = change.data.schedule as ReminderSchedule;
        const recipientIds = change.data.recipients as string[];
        return deps.createReminder(token, String(change.data.projectId), String(change.data.taskId), { id: change.entityId, ...schedule, recipientIds });
      },
      update: (change, token) => {
        const fields: ReminderFieldPatch = {};
        if (change.data.schedule !== undefined) fields.schedule = { value: change.data.schedule as ReminderSchedule, editedAt: timeOf(change, "schedule") };
        if (change.data.recipients !== undefined) fields.recipients = { value: change.data.recipients as string[], editedAt: timeOf(change, "recipients") };
        return deps.patchReminder(token, String(change.data.projectId), String(change.data.taskId), change.entityId, fields);
      },
      delete: (change, token) => deps.deleteReminder(token, String(change.data.projectId), String(change.data.taskId), change.entityId),
    },
    handlers,
  );
}
