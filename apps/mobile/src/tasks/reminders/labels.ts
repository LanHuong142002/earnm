import { occurrencesBetween } from "./occurrences";
import type { ReminderSchedule } from "./types";

type T = (key: string, options?: Record<string, unknown>) => string;

const DAY_MS = 86_400_000;

/** `09:00` -> `9:00`; the hour has no leading zero in a row. */
export function clockLabel(time: string): string {
  const [h, m] = time.split(":");
  return `${Number(h)}:${m}`;
}

/** `T6, 21 Thg 11` (vi) / `Fri, 21 Nov` (en): weekday and month names come from `t`, never from Intl. */
export function dayLabel(date: string, t: T): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${t(`tasks.weekday.${new Date(y, m - 1, d).getDay()}`)}, ${d} ${t(`tasks.month.${m}`)}`;
}

/** `21 Thg 11` / `21 Nov`. */
function shortDay(date: string, t: T): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${t(`tasks.month.${m}`)}`;
}

/** Weekdays in the order of a week that starts on Monday: T2 .. T7, CN. */
function weekdayNames(weekdays: number[], t: T): string {
  return [...new Set(weekdays)]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => t(`tasks.weekday.${d}`))
    .join(", ");
}

/**
 * The text of a reminder row: `8:00 · Hằng ngày`, `T6, 21 Thg 11 · 15:00 · Một lần`, `9:00 · T2, T4, T6`.
 * A repeating reminder with an end date gets ` · đến 21 Thg 11` after it.
 */
export function reminderLabel(schedule: ReminderSchedule, t: T): string {
  const time = clockLabel(schedule.time);
  let text: string;
  switch (schedule.repeat) {
    case "once":
      return `${dayLabel(schedule.startDate, t)} · ${time} · ${t("tasks.reminders.once")}`;
    case "daily":
      text = `${time} · ${t("tasks.reminders.daily")}`;
      break;
    case "weekly":
      text = `${time} · ${weekdayNames(schedule.weekdays, t)}`;
      break;
    case "monthly":
      text = `${time} · ${t("tasks.reminders.monthlyOn", { day: Number(schedule.startDate.slice(8, 10)) })}`;
      break;
  }
  return schedule.endDate === null ? text : `${text} · ${t("tasks.reminders.until", { date: shortDay(schedule.endDate, t) })}`;
}

/**
 * True when the reminder will not fire again: its task is done, a one-off has passed, or its end date has.
 * (AC24: the row shows these as stopped.)
 */
export function isStopped(schedule: ReminderSchedule, taskDone: boolean, now: Date): boolean {
  if (taskDone) return true;
  if (schedule.repeat !== "once" && schedule.endDate === null) return false;
  // Nothing fires after the end date (or, for a one-off, after its day), so look a little past it.
  const last = schedule.endDate ?? schedule.startDate;
  const horizon = new Date(`${last}T00:00:00Z`).getTime() + 3 * DAY_MS;
  if (horizon < now.getTime()) return true;
  return occurrencesBetween(schedule, now, new Date(horizon)).length === 0;
}

export type ReminderRowModel = { text: string; stopped: boolean; waiting: boolean };

/** What a reminder row shows: its text, whether it has stopped, and whether it is still waiting to be saved. */
export function reminderRowModel(
  reminder: ReminderSchedule & { state: "synced" | "waiting" },
  taskDone: boolean,
  now: Date,
  t: T,
): ReminderRowModel {
  return { text: reminderLabel(reminder, t), stopped: isStopped(reminder, taskDone, now), waiting: reminder.state === "waiting" };
}
