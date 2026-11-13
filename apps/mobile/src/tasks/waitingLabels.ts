import type { Queue, NewChange } from "../sync/queue";
import { TASK_LABELS_ENTITY } from "./entities";

/**
 * Helpers for waiting changes that depend on a label. They live here, not in the shared queue, which
 * knows nothing about labels: they read the queue's waiting list and enqueue ordinary changes.
 *
 * A task's labels are their own queue change (`taskLabels`, `entityId` = task id, `data` = { projectId, labels }),
 * so they never ride in a task update that may already be on its way.
 */

/**
 * Takes `labelId` out of every waiting taskLabels change in the project (a label that was refused by the
 * server, or deleted here). Each affected task gets a new label set without it and with a fresh time, which
 * the queue folds into the waiting change.
 */
export async function stripLabelFromWaiting(queue: Queue, projectId: string, labelId: string, now: Date): Promise<void> {
  const waiting = await queue.waiting();
  const at = now.toISOString();
  for (const change of waiting) {
    if (change.entity !== TASK_LABELS_ENTITY || change.data.projectId !== projectId) continue;
    if (!Array.isArray(change.data.labels) || !(change.data.labels as unknown[]).includes(labelId)) continue;
    const labels = (change.data.labels as string[]).filter((id) => id !== labelId);
    await queue.enqueue({
      entity: TASK_LABELS_ENTITY,
      entityId: change.entityId,
      kind: "update",
      data: { projectId, labels },
      fieldTimes: { projectId: at, labels: at },
    });
  }
}

/**
 * Queues a task's new label set. The queue is first in, first out and merges a task's waiting labels
 * into one change, so if the task's waiting labels change sits before a waiting label create the new
 * set uses, merging would send the set before the label exists. In that case the older labels change
 * is dropped and the new set queued at the end. Only the label set moves: task, checklist and item
 * changes are never touched. A crash between the drop and the enqueue loses nothing but this task's
 * label set (which the next refresh brings back from the server).
 */
export async function queueTaskLabels(queue: Queue, change: NewChange): Promise<void> {
  const waiting = await queue.waiting();
  const labels = Array.isArray(change.data.labels) ? (change.data.labels as string[]) : [];
  let lastOwn = -1;
  waiting.forEach((c, i) => {
    if (c.entity === TASK_LABELS_ENTITY && c.entityId === change.entityId) lastOwn = i;
  });
  const needsMove =
    lastOwn >= 0 && waiting.some((c, i) => i > lastOwn && c.entity === "label" && c.kind === "create" && labels.includes(c.entityId));
  if (needsMove) await queue.dropEntity(TASK_LABELS_ENTITY, change.entityId);
  await queue.enqueue(change);
}
