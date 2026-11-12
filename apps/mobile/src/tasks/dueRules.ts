import { dateToDay, dateToTime, dayToDate } from "./formState";

type Due = { dueDate: string | null; dueTime: string | null };

/** True when the due day (and time, if any) is before `now`. A day with no time lasts until its end. */
export function dueIsInPast(day: string, time: string | null, now: Date): boolean {
  const today = dateToDay(now);
  if (day < today) return true;
  if (day > today) return false;
  return time !== null && time < dateToTime(now);
}

/** The earliest time the clock may show for `day`: now when the day is today, otherwise no limit. */
export function minimumTimeFor(day: string, now: Date): Date | undefined {
  return day === dateToDay(now) ? now : undefined;
}

/** The earliest day the calendar may show: today (at noon, as every picked day is). */
export function minimumDay(now: Date): Date {
  return dayToDate(dateToDay(now));
}

/**
 * Why a due value the person set or changed can't be saved, or null. A value left as it opened
 * (an overdue task saved unchanged) is never checked, and clearing is always fine.
 */
export function dueChangeError(
  opened: Due,
  form: Due,
  now: Date,
): "tasks.errors.dueDatePast" | "tasks.errors.dueTimePast" | null {
  if (form.dueDate === null) return null;
  const dayChanged = form.dueDate !== opened.dueDate;
  const timeChanged = form.dueTime !== opened.dueTime;
  if (!dayChanged && !timeChanged) return null;
  if (dayChanged && form.dueDate < dateToDay(now)) return "tasks.errors.dueDatePast";
  if (form.dueTime !== null && dueIsInPast(form.dueDate, form.dueTime, now)) return "tasks.errors.dueTimePast";
  return null;
}

/** The time a newly opened clock starts on: noon, or now when today's noon has passed. */
export function defaultTimeFor(day: string, now: Date): string {
  return dueIsInPast(day, "12:00", now) ? dateToTime(now) : "12:00";
}
