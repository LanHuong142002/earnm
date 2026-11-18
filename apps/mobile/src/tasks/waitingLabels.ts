import type { Queue, NewChange } from "../sync/queue";
import { IDEA_LABELS_ENTITY } from "../ideas/entities";
import { LABEL_ENTITY, TASK_LABELS_ENTITY } from "./entities";

/** The entities that hold a whole set of label ids: a task's and an idea's. */
const LABEL_SET_ENTITIES: readonly string[] = [TASK_LABELS_ENTITY, IDEA_LABELS_ENTITY];

/**
 * Helpers for waiting changes that depend on a label. They live here, not in the shared queue, which
 * knows nothing about labels: they read the queue's waiting list and enqueue ordinary changes.
 *
 * A task's labels are their own queue change (`taskLabels`, `entityId` = task id, `data` = { projectId, labels }),
 * so they never ride in a task update that may already be on its way. An idea's labels are the same
 * (`ideaLabels`), so everything here covers both.
 */

/**
 * Takes `labelId` out of every waiting label set (a task's or an idea's) in the project (a label that was refused by the
 * server, or deleted here). Each affected task or idea gets a new label set without it and with a fresh time, which
 * the queue folds into the waiting change.
 */
export async function stripLabelFromWaiting(queue: Queue, projectId: string, labelId: string, now: Date): Promise<void> {
  const waiting = await queue.waiting();
  const at = now.toISOString();
  for (const change of waiting) {
    if (!LABEL_SET_ENTITIES.includes(change.entity) || change.data.projectId !== projectId) continue;
    if (!Array.isArray(change.data.labels) || !(change.data.labels as unknown[]).includes(labelId)) continue;
    const labels = (change.data.labels as string[]).filter((id) => id !== labelId);
    await queue.enqueue({
      entity: change.entity,
      entityId: change.entityId,
      kind: "update",
      data: { projectId, labels },
      fieldTimes: { projectId: at, labels: at },
    });
  }
}

/**
 * Queues a label delete. A label create the server never saw (still waiting, never attempted) is removed
 * together with the delete, so the delete's sender never runs: the label is taken off the waiting label
 * sets here, first. Every other case is cleaned by the delete's sender once the server has answered.
 */
export async function queueLabelDelete(queue: Queue, change: NewChange, now: Date): Promise<void> {
  const projectId = String(change.data.projectId);
  const unsent = (await queue.waiting()).some(
    (c) => c.entity === LABEL_ENTITY && c.kind === "create" && c.entityId === change.entityId && (c.attempts ?? 0) === 0,
  );
  if (unsent) await stripLabelFromWaiting(queue, projectId, change.entityId, now);
  await queue.enqueue(change);
}

/**
 * Queues a task's or an idea's new label set (`change.entity` says which). The queue is first in, first out and merges a waiting labels
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
    if (c.entity === change.entity && c.entityId === change.entityId) lastOwn = i;
  });
  const needsMove =
    lastOwn >= 0 && waiting.some((c, i) => i > lastOwn && c.entity === "label" && c.kind === "create" && labels.includes(c.entityId));
  if (needsMove) await queue.dropEntity(change.entity, change.entityId);
  await queue.enqueue(change);
}
