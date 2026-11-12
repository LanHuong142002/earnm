import { isDueSoon } from "./dueDate";
import type { Task, TaskStatus } from "./types";

export type TaskFilters = {
  status: "all" | TaskStatus;
  /** Only tasks where I'm an assignee. */
  mine: boolean;
  dueSoon: boolean;
};

export const DEFAULT_FILTERS: TaskFilters = { status: "all", mine: false, dueSoon: false };

/** Every chosen condition must hold (spec R24). Returns a new array in the input order. */
export function applyFilters(tasks: Task[], filters: TaskFilters, myId: string, now: Date): Task[] {
  return tasks.filter((task) => {
    if (filters.status !== "all" && task.status !== filters.status) return false;
    if (filters.mine && !task.assignees.some((a) => a.id === myId)) return false;
    if (filters.dueSoon && !isDueSoon(task, now)) return false;
    return true;
  });
}
