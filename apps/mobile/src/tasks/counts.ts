import { applyFilters, type TaskFilters } from "./filters";
import { orderTasks } from "./listOrder";
import type { Task } from "./types";

/** Tasks still to do or in progress, for the Project screen's Tasks tile. */
export function countNotDone(tasks: Task[]): number {
  return tasks.filter((t) => t.status !== "done").length;
}

/**
 * What the Task list shows. With status All the Done tasks go in their own closed section (spec
 * R22). With any other status filter there is no such section (R24): a Done filter lists the
 * done tasks in the main list.
 */
export function visibleTasks(
  tasks: Task[],
  filters: TaskFilters,
  myId: string,
  now: Date,
): { open: Task[]; done: Task[]; total: number } {
  const filtered = applyFilters(tasks, filters, myId, now);
  const ordered = orderTasks(filtered, now);
  if (filters.status === "all") return { ...ordered, total: filtered.length };
  return { open: [...ordered.open, ...ordered.done], done: [], total: filtered.length };
}
