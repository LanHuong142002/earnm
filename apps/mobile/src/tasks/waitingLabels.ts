import type { Change, NewChange, Queue } from "../sync/queue";
import { TASK_ENTITY } from "./sync";

/**
 * Helpers for waiting changes that depend on a label. They live here, not in the shared queue, which
 * knows nothing about labels: they read the queue's waiting list and enqueue ordinary task updates.
 */

/** Waiting task changes in this project that put `labelId` on a task, with the set they would send. */
function changesWithLabel(waiting: Change[], projectId: string, labelId: string): Change[] {
  return waiting.filter(
    (c) =>
      c.entity === TASK_ENTITY &&
      c.kind !== "delete" &&
      c.data.projectId === projectId &&
      Array.isArray(c.data.labels) &&
      (c.data.labels as unknown[]).includes(labelId),
  );
}

/**
 * Takes `labelId` out of every waiting task-label change (a label that was deleted here, or refused by
 * the server). Each affected task gets a new label update without it and with a fresh time, which the
 * queue folds into the waiting change.
 */
export async function stripLabelFromWaiting(queue: Queue, projectId: string, labelId: string, now: Date): Promise<void> {
  const waiting = await queue.waiting();
  const at = now.toISOString();
  for (const change of changesWithLabel(waiting, projectId, labelId)) {
    // A task that is about to be deleted needs no update after its delete.
    if (waiting.some((c) => c.entity === TASK_ENTITY && c.entityId === change.entityId && c.kind === "delete")) continue;
    const labels = (change.data.labels as string[]).filter((id) => id !== labelId);
    await queue.enqueue({
      entity: TASK_ENTITY,
      entityId: change.entityId,
      kind: "update",
      data: { projectId, labels },
      fieldTimes: { projectId: at, labels: at },
    });
  }
}

/**
 * The label order problem: the queue is first in, first out, but a task's waiting changes merge into
 * one. If a task already waits ahead of a label it is about to use (the label is created or renamed
 * after it), the merged task change would reach the server before the label. This returns the task's
 * waiting changes to send again after the label's, or null when the order is already right or the
 * task has a change in flight (which cannot be moved).
 */
export function taskChangesToResend(waiting: Change[], taskId: string, labelIds: string[]): NewChange[] | null {
  const taskIndexes = waiting.flatMap((c, i) => (c.entity === "task" && c.entityId === taskId ? [i] : []));
  if (taskIndexes.length === 0) return null;
  if (taskIndexes.some((i) => (waiting[i].attempts ?? 0) > 0)) return null;
  const firstTask = taskIndexes[0];
  const ids = new Set(labelIds);
  const labelAfter = waiting.some((c, i) => i > firstTask && c.entity === "label" && c.kind === "create" && ids.has(c.entityId));
  if (!labelAfter) return null;
  return taskIndexes.map((i) => {
    const c = waiting[i];
    return { entity: c.entity, entityId: c.entityId, kind: c.kind, data: { ...c.data }, fieldTimes: { ...c.fieldTimes } };
  });
}
