import { dueMoment, isOverdue } from "./dueDate";
import type { Task } from "./types";

function created(task: Task): number {
  const t = Date.parse(task.createdAt);
  return Number.isNaN(t) ? 0 : t;
}

function byCreated(a: Task, b: Task): number {
  return created(a) - created(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Spec R22. Open tasks: overdue first, then soonest due moment, then no due date, ties by
 * creation time (oldest first). Done tasks come back separately, oldest first.
 */
export function orderTasks(tasks: Task[], now: Date): { open: Task[]; done: Task[] } {
  const done = tasks.filter((t) => t.status === "done").sort(byCreated);
  const open = tasks
    .filter((t) => t.status !== "done")
    .map((task) => ({
      task,
      overdue: isOverdue(task, now),
      moment: task.dueDate === null ? Infinity : dueMoment(task.dueDate, task.dueTime).getTime(),
    }))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.moment !== b.moment) return a.moment < b.moment ? -1 : 1;
      return byCreated(a.task, b.task);
    })
    .map((x) => x.task);
  return { open, done };
}
