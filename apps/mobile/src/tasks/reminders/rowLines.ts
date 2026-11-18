import { isStopped, reminderLabel, shortDay, type T } from "./labels";
import type { Reminder } from "./types";

export type ReminderRowLines = { title: string; subtitle: string; stopped: boolean; waiting: boolean };

/**
 * What a reminder row shows (spec R22, R24, R28): the time and repeat, then the people it goes to and its end date,
 * whether it has stopped (task done, one-off passed, end date passed), and whether it still waits to be saved.
 */
export function reminderRowLines(
  reminder: Reminder,
  names: Record<string, string>,
  taskDone: boolean,
  now: Date,
  t: T,
): ReminderRowLines {
  const people = reminder.recipientIds.map((id) => names[id]).filter((n): n is string => Boolean(n));
  const until = reminder.endDate !== null && reminder.repeat !== "once" ? t("tasks.reminders.until", { date: shortDay(reminder.endDate, t) }) : null;
  return {
    // The end date is on the second line, so the first line leaves it out.
    title: reminderLabel({ ...reminder, endDate: null }, t),
    subtitle: [people.join(", "), until].filter((s): s is string => s !== null && s !== "").join(" · "),
    stopped: isStopped(reminder, taskDone, now),
    waiting: reminder.state === "waiting",
  };
}
