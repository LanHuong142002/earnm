import { changesFromForm, validateReminderForm, type ReminderForm, type ReminderFormErrors } from "./formState";

/**
 * What the form shows as wrong right now (spec R27). When editing, a past date only counts if the schedule was
 * changed: saving a past one-off's recipients is fine. "Lưu" is disabled while this has anything in it.
 */
export function visibleErrors(opened: ReminderForm | null, form: ReminderForm, now: Date): ReminderFormErrors {
  const errors = validateReminderForm(form, now);
  if (opened !== null && changesFromForm(opened, form).schedule === undefined) delete errors.date;
  return errors;
}

/** An end date to start from when "Vào ngày" is chosen: a week after the start day, so it is never before it. */
export function defaultEndDate(startDate: string): string {
  const [y, m, d] = startDate.split("-").map(Number) as [number, number, number];
  const end = new Date(Date.UTC(y, m - 1, d + 7));
  return end.toISOString().slice(0, 10);
}

/** Switching a recipient on or off. Order of the others is kept; a new one goes last. */
export function toggleRecipient(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Switching a weekday on or off, always in order Sunday..Saturday. */
export function toggleWeekday(days: number[], day: number): number[] {
  return (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]).sort((a, b) => a - b);
}
