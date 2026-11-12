import type { Task } from "./types";

/** Days after today (inclusive of today + 3) that still count as "due soon" (spec R25). */
const SOON_DAYS = 3;

function parseDay(dueDate: string): { y: number; m: number; d: number } {
  const [y, m, d] = dueDate.split("-").map(Number);
  return { y, m, d };
}

/**
 * The moment a task is due, in the phone's local time. A date without a time means the
 * end of that day (the last millisecond, so "before the due moment" == "still on time").
 */
export function dueMoment(dueDate: string, dueTime: string | null): Date {
  const { y, m, d } = parseDay(dueDate);
  if (dueTime === null) return new Date(y, m - 1, d, 23, 59, 59, 999);
  const [hh, mm] = dueTime.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

type DueFields = Pick<Task, "status" | "dueDate" | "dueTime">;

export function isOverdue(task: DueFields, now: Date): boolean {
  if (task.status === "done" || task.dueDate === null) return false;
  return dueMoment(task.dueDate, task.dueTime).getTime() < now.getTime();
}

/** Not done, has a due date, and due before the end of today + 3 days; overdue counts. */
export function isDueSoon(task: DueFields, now: Date): boolean {
  if (task.status === "done" || task.dueDate === null) return false;
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + SOON_DAYS, 23, 59, 59, 999);
  return dueMoment(task.dueDate, task.dueTime).getTime() <= limit.getTime();
}

export type DueLanguage = "vi" | "en";

/**
 * `Fri, 14 Nov · 14:30` (en) or `T6, 14/11 · 14:30` (vi). Weekday and month names come
 * from `t` (keys `tasks.weekday.0..6`, Sunday = 0, and `tasks.month.1..12`), so the
 * output never depends on Intl or the device locale.
 */
export function formatDue(
  dueDate: string,
  dueTime: string | null,
  lang: DueLanguage,
  t: (key: string) => string,
): string {
  const { y, m, d } = parseDay(dueDate);
  const weekday = t(`tasks.weekday.${new Date(y, m - 1, d).getDay()}`);
  const day = lang === "vi" ? `${d}/${m}` : `${d} ${t(`tasks.month.${m}`)}`;
  const base = `${weekday}, ${day}`;
  return dueTime === null ? base : `${base} · ${dueTime}`;
}
