import type { Change } from "../../sync/queue";
import { REMINDER_ENTITY } from "../entities";
import type { Reminder, ReminderSchedule, ReminderState, ServerReminder } from "./types";

function isSchedule(v: unknown): v is ReminderSchedule {
  return typeof v === "object" && v !== null && typeof (v as ReminderSchedule).startDate === "string" && typeof (v as ReminderSchedule).time === "string";
}

const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function apply(list: Reminder[], change: Change): Reminder[] {
  const { data } = change;
  const index = list.findIndex((r) => r.id === change.entityId);
  if (change.kind === "delete") return index === -1 ? list : list.filter((r) => r.id !== change.entityId);
  if (change.kind === "update") {
    if (index === -1) return list;
    return list.map((r, i) => {
      if (i !== index) return r;
      const next: Reminder = { ...r, state: "waiting" as ReminderState };
      if (isSchedule(data.schedule)) Object.assign(next, data.schedule);
      if (isIds(data.recipients)) next.recipientIds = data.recipients;
      return next;
    });
  }
  if (index !== -1 || !isSchedule(data.schedule)) return list; // the server already has it
  const added: Reminder = {
    id: change.entityId,
    taskId: String(data.taskId),
    ...data.schedule,
    recipientIds: isIds(data.recipients) ? data.recipients : [],
    createdById: null,
    changedAt: change.createdAt,
    state: "waiting",
  };
  return [...list, added];
}

/**
 * The reminders as the screen shows them: the server's list with the waiting changes laid over it. A waiting
 * create is a waiting reminder, a waiting edit shows its new values, a waiting delete hides the reminder.
 * Changes for a reminder that is not there are ignored. With `projectId`, only that project's changes count.
 */
export function applyReminderOverlay(serverList: ServerReminder[], waiting: Change[], projectId?: string): Reminder[] {
  let list: Reminder[] = serverList.map((r) => ({ ...r, state: "synced" as const }));
  for (const change of waiting) {
    if (change.entity !== REMINDER_ENTITY) continue;
    if (projectId !== undefined && change.data.projectId !== projectId) continue;
    list = apply(list, change);
  }
  return list;
}
