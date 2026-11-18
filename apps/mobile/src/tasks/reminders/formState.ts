import { dateToDay } from "../formState";
import type { Task } from "../types";
import { isFutureOnce } from "./occurrences";
import type { ReminderRepeat, ReminderSchedule, ServerReminder } from "./types";

export const MAX_RECIPIENTS = 20;
/** A task holds at most this many reminders. */
export const MAX_REMINDERS_PER_TASK = 5;
const DEFAULT_TIME = "09:00";

/** What the reminder form holds. */
export type ReminderForm = ReminderSchedule & { recipientIds: string[] };

/** The device's own time zone (an IANA name), which a new reminder is set in. */
export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * A new reminder's starting values (spec R4, R5). It goes to the task's assignees, or to its creator when there
 * are none (or to me when the creator is gone too). It fires once, at the due date and time; with a date but no
 * time at 9:00 that day; with no date at 9:00 tomorrow.
 */
export function defaultReminderForm(input: { task: Task; meId: string; now: Date; timezone: string }): ReminderForm {
  const { task, meId, now, timezone } = input;
  const assigned = task.assignees.map((a) => a.id);
  const recipientIds = assigned.length > 0 ? assigned : [task.createdById ?? meId];
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
  return {
    startDate: task.dueDate ?? dateToDay(tomorrow),
    time: task.dueDate !== null && task.dueTime !== null ? task.dueTime : DEFAULT_TIME,
    timezone,
    repeat: "once",
    weekdays: [],
    endDate: null,
    recipientIds,
  };
}

export function formFromReminder(reminder: ServerReminder): ReminderForm {
  return {
    startDate: reminder.startDate,
    time: reminder.time,
    timezone: reminder.timezone,
    repeat: reminder.repeat,
    weekdays: [...reminder.weekdays],
    endDate: reminder.endDate,
    recipientIds: [...reminder.recipientIds],
  };
}

/** Changing the kind. A weekly reminder starts on the weekday of its start date when none is chosen. */
export function setRepeat(form: ReminderForm, repeat: ReminderRepeat): ReminderForm {
  if (repeat === "weekly" && form.weekdays.length === 0) {
    const [y, m, d] = form.startDate.split("-").map(Number) as [number, number, number];
    return { ...form, repeat, weekdays: [new Date(y, m - 1, d).getDay()] };
  }
  return { ...form, repeat };
}

/** The schedule the form means: weekdays only for a weekly reminder, an end date only for a repeating one. */
export function scheduleFromForm(form: ReminderForm): ReminderSchedule {
  return {
    startDate: form.startDate,
    time: form.time,
    timezone: form.timezone,
    repeat: form.repeat,
    weekdays: form.repeat === "weekly" ? [...new Set(form.weekdays)].sort((a, b) => a - b) : [],
    endDate: form.repeat === "once" ? null : form.endDate,
  };
}

/** i18n keys of what is wrong, by field. Empty when the form can be saved. */
export type ReminderFormErrors = { date?: string; recipients?: string; weekdays?: string; endDate?: string };

export function validateReminderForm(form: ReminderForm, now: Date): ReminderFormErrors {
  const errors: ReminderFormErrors = {};
  const schedule = scheduleFromForm(form);
  if (!isFutureOnce(schedule, now)) errors.date = "tasks.reminders.errors.past";
  if (form.recipientIds.length === 0) errors.recipients = "tasks.reminders.errors.recipients";
  else if (form.recipientIds.length > MAX_RECIPIENTS) errors.recipients = "tasks.reminders.errors.tooManyRecipients";
  if (form.repeat === "weekly" && form.weekdays.length === 0) errors.weekdays = "tasks.reminders.errors.weekdays";
  if (schedule.endDate !== null && schedule.endDate < schedule.startDate) errors.endDate = "tasks.reminders.errors.endBeforeStart";
  return errors;
}

const sameSchedule = (a: ReminderSchedule, b: ReminderSchedule) =>
  a.startDate === b.startDate &&
  a.time === b.time &&
  a.timezone === b.timezone &&
  a.repeat === b.repeat &&
  a.endDate === b.endDate &&
  a.weekdays.length === b.weekdays.length &&
  a.weekdays.every((d, i) => d === b.weekdays[i]);

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** Only the parts that differ from what the form opened with, so a refresh in between isn't reverted. */
export function changesFromForm(opened: ReminderForm, form: ReminderForm): { schedule?: ReminderSchedule; recipients?: string[] } {
  const changes: { schedule?: ReminderSchedule; recipients?: string[] } = {};
  const next = scheduleFromForm(form);
  if (!sameSchedule(scheduleFromForm(opened), next)) changes.schedule = next;
  if (!sameIds(opened.recipientIds, form.recipientIds)) changes.recipients = [...form.recipientIds];
  return changes;
}
