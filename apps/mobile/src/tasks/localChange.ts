import type { NewChange } from "../sync/queue";
import { applyTaskOverlay } from "./store";
import type { Task, TaskAssignee } from "./types";

/**
 * The people a task can name, from what is known on the phone: me first, then assignees already on
 * cached tasks, then `extra` (the real member list, once there is one). Later sources win for a name.
 */
export function deriveMembers(me: TaskAssignee | null, cachedTasks: Task[], extra: TaskAssignee[]): TaskAssignee[] {
  const byId = new Map<string, TaskAssignee>();
  const add = (person: TaskAssignee) => byId.set(person.id, { ...person });
  for (const task of cachedTasks) task.assignees.forEach(add);
  extra.forEach(add);
  if (me) {
    byId.delete(me.id);
    return [{ ...me }, ...byId.values()];
  }
  return [...byId.values()];
}

/** `list` with a change the person just made laid over it, to show at once (R16). */
export function showLocalChange(list: Task[], projectId: string, change: NewChange, now: Date): Task[] {
  return applyTaskOverlay(
    projectId,
    list,
    [{ ...change, fieldTimes: change.fieldTimes ?? {}, changeId: "local", createdAt: now.toISOString() }],
  );
}
