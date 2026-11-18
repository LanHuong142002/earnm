import type { Change } from "../../sync/queue";
import type { Task } from "../types";
import { applyReminderOverlay } from "./overlay";
import type { ReminderCache } from "./store";
import type { RemindWithLine, Reminder } from "./types";

/**
 * What the scheduler plans from: every project's reminders with the waiting changes laid over them (so an edit made
 * offline schedules at once, R28), the "Nhắc kèm" lines by task, and only the tasks of those projects.
 */
export function scheduleSource(input: {
  cache: ReminderCache;
  waiting: Change[];
  projectIds: string[];
  tasksFor: (projectId: string) => Task[];
}): { reminders: Reminder[]; remindWith: Record<string, RemindWithLine[]>; tasks: Task[] } {
  const reminders: Reminder[] = [];
  const remindWith: Record<string, RemindWithLine[]> = {};
  const tasks: Task[] = [];
  for (const projectId of input.projectIds) {
    const served = input.cache.byProject[projectId];
    reminders.push(...applyReminderOverlay(served?.reminders ?? [], input.waiting, projectId));
    Object.assign(remindWith, served?.remindWith ?? {});
    tasks.push(...input.tasksFor(projectId));
  }
  return { reminders, remindWith, tasks };
}
