import type { ServerComment } from "./comments/types";
import type { ProjectRole, Task } from "./types";

/** Spec R6: the creator or an Owner. A task with no creator is deletable only by an Owner. */
export function canDeleteTask(task: Pick<Task, "createdById">, myId: string, myRole: ProjectRole): boolean {
  if (myRole === "owner") return true;
  return task.createdById !== null && task.createdById === myId;
}

/** Spec R6: only an Owner deletes a label. */
export function canDeleteLabel(myRole: ProjectRole): boolean {
  return myRole === "owner";
}

/** Spec R7: the task's creator or one of its assignees. Decides who may set the reminder-with-comment flag. */
export function isInvolved(task: Pick<Task, "createdById" | "assignees">, userId: string | null): boolean {
  if (userId === null) return false;
  return task.createdById === userId || task.assignees.some((a) => a.id === userId);
}

/** Only a comment's author edits or deletes it; an Owner has no exception. */
export function canEditComment(comment: Pick<ServerComment, "author">, userId: string | null): boolean {
  return userId !== null && comment.author !== null && comment.author.id === userId;
}
