import type { ProjectRole, Task } from "./types";

/** Spec R6: the creator or an Owner. A task with no creator is deletable only by an Owner. */
export function canDeleteTask(task: Pick<Task, "createdById">, myId: string, myRole: ProjectRole): boolean {
  if (myRole === "owner") return true;
  return task.createdById !== null && task.createdById === myId;
}
