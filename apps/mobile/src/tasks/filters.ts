import { isDueSoon } from "./dueDate";
import type { Label, Task, TaskStatus } from "./types";

export type TaskFilters = {
  status: "all" | TaskStatus;
  /** Only tasks where I'm an assignee. */
  mine: boolean;
  /** Only tasks where I am the one and only assignee. */
  onlyMe: boolean;
  dueSoon: boolean;
  /** Tasks with any of these labels; empty means no label filter. */
  labelIds: string[];
};

export const DEFAULT_FILTERS: TaskFilters = { status: "all", mine: false, onlyMe: false, dueSoon: false, labelIds: [] };

/**
 * Every chosen condition must hold (spec R24). Returns a new array in the input order.
 * `labels` is the current project's label list: chosen label ids that are not in it (a deleted
 * label) are ignored, and when none is left there is no label filter (spec R9).
 */
export function applyFilters(
  tasks: Task[],
  filters: TaskFilters,
  myId: string,
  now: Date,
  labels: readonly Pick<Label, "id">[] = [],
): Task[] {
  const known = new Set(labels.map((l) => l.id));
  const chosen = filters.labelIds.filter((id) => known.has(id));
  return tasks.filter((task) => {
    if (filters.status !== "all" && task.status !== filters.status) return false;
    if (filters.mine && !task.assignees.some((a) => a.id === myId)) return false;
    if (filters.onlyMe && !(task.assignees.length === 1 && task.assignees[0].id === myId)) return false;
    if (filters.dueSoon && !isDueSoon(task, now)) return false;
    if (chosen.length > 0 && !task.labelIds.some((id) => chosen.includes(id))) return false;
    return true;
  });
}
