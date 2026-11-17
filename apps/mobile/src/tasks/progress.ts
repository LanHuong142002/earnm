import type { Checklist, Task } from "./types";

export type Progress = { done: number; total: number };

/** Done and total items of one checklist, or null when it has no items (spec R2). */
export function checklistProgress(checklist: Pick<Checklist, "items">): Progress | null {
  const total = checklist.items.length;
  if (total === 0) return null;
  return { done: checklist.items.filter((i) => i.done).length, total };
}

/** Done and total items across all of a task's checklists, or null when there are none (spec R2). */
export function taskProgress(task: Pick<Task, "checklists">): Progress | null {
  let done = 0;
  let total = 0;
  for (const list of task.checklists) {
    const p = checklistProgress(list);
    if (p !== null) {
      done += p.done;
      total += p.total;
    }
  }
  return total === 0 ? null : { done, total };
}
