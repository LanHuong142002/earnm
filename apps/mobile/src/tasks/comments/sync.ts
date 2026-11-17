import type { Change, NewChange, Queue } from "../../sync/queue";
import type { KeyValueStore } from "../../sync/storage";
import { COMMENT_ENTITY } from "../entities";
import { createComment, deleteComment, patchComment, type CommentFieldPatch } from "./api";
import { recordFailed, updateCommentCache, withoutFailed } from "./store";

type Deps = {
  createComment: typeof createComment;
  patchComment: typeof patchComment;
  deleteComment: typeof deleteComment;
};

const realDeps: Deps = { createComment, patchComment, deleteComment };

const timeOf = (change: Change, field: string) => change.fieldTimes[field] ?? change.createdAt;

// Refusals are saved a moment after the queue reports them; readers wait for these before they look.
const pendingFailures = new Set<Promise<unknown>>();

/** Resolves once every refusal reported so far has been saved as failed. */
export async function settleFailures(): Promise<void> {
  while (pendingFailures.size > 0) await Promise.all([...pendingFailures]);
}

type Where = { projectId: string; taskId: string };

/**
 * Queued comment changes (see `CommentChangeData`). Text and the reminder flag are separate fields of an
 * update, each with its own time, so changes made on two phones merge per field and two quick edits of one
 * comment leave one request.
 */
export function commentCreateChange(input: Where & {
  id: string;
  text: string;
  remindWith: boolean;
  author: { id: string; displayName: string } | null;
  now: Date;
}): NewChange {
  const data: Record<string, unknown> = { projectId: input.projectId, taskId: input.taskId, text: input.text, remindWith: input.remindWith };
  if (input.author) {
    data.authorId = input.author.id;
    data.authorName = input.author.displayName;
  }
  const at = input.now.toISOString();
  return { entity: COMMENT_ENTITY, entityId: input.id, kind: "create", data, fieldTimes: { text: at, remindWith: at } };
}

export function commentTextChange(input: Where & { id: string; text: string; now: Date }): NewChange {
  return {
    entity: COMMENT_ENTITY,
    entityId: input.id,
    kind: "update",
    data: { projectId: input.projectId, taskId: input.taskId, text: input.text },
    fieldTimes: { text: input.now.toISOString() },
  };
}

export function commentRemindChange(input: Where & { id: string; remindWith: boolean; now: Date }): NewChange {
  return {
    entity: COMMENT_ENTITY,
    entityId: input.id,
    kind: "update",
    data: { projectId: input.projectId, taskId: input.taskId, remindWith: input.remindWith },
    fieldTimes: { remindWith: input.now.toISOString() },
  };
}

export function commentDeleteChange(input: Where & { id: string }): NewChange {
  return { entity: COMMENT_ENTITY, entityId: input.id, kind: "delete", data: { projectId: input.projectId, taskId: input.taskId }, fieldTimes: {} };
}

/**
 * Registers comments with the shared queue. The queue folds an edit into a waiting create and a delete
 * into a waiting create (nothing is sent). A permanent refusal is not the task-wide notice: the change is
 * kept in the comment cache as failed, to retry or discard (spec R16). The queue only calls this for a
 * refusal no resend will change; a network error or a 429 stays in the queue and is tried again.
 */
export function registerCommentEntity(queue: Queue, store: KeyValueStore, deps: Deps = realDeps): void {
  queue.registerEntity(
    COMMENT_ENTITY,
    {
      create: (change, token) => {
        const body: { id: string; text: string; remindWith?: boolean } = { id: change.entityId, text: String(change.data.text ?? "") };
        if (change.data.remindWith === true) body.remindWith = true;
        return deps.createComment(token, String(change.data.projectId), String(change.data.taskId), body);
      },
      update: (change, token) => {
        const fields: CommentFieldPatch = {};
        if (typeof change.data.text === "string") fields.text = { value: change.data.text, editedAt: timeOf(change, "text") };
        if (typeof change.data.remindWith === "boolean") fields.remindWith = { value: change.data.remindWith, editedAt: timeOf(change, "remindWith") };
        return deps.patchComment(token, String(change.data.projectId), String(change.data.taskId), change.entityId, fields);
      },
      delete: (change, token) => deps.deleteComment(token, String(change.data.projectId), String(change.data.taskId), change.entityId),
    },
    {
      onApplied: () => {},
      onRejected: (change) => {
        const write = (async () => {
          const owner = await queue.ownerId();
          if (owner) await updateCommentCache(store, owner, (cache) => recordFailed(cache, change));
        })()
          .catch(() => {})
          .finally(() => pendingFailures.delete(write));
        pendingFailures.add(write);
      },
    },
  );
}

/** Puts a comment's refused changes back on the queue, oldest first, and forgets them as failed. */
export async function retryFailed(queue: Queue, store: KeyValueStore, ownerId: string, commentId: string): Promise<void> {
  let taken: Change[] = [];
  await updateCommentCache(store, ownerId, (cache) => {
    taken = cache.failed.filter((c) => c.entityId === commentId);
    return withoutFailed(cache, (c) => c.entityId === commentId);
  });
  for (const change of taken) {
    await queue.enqueue({ entity: change.entity, entityId: change.entityId, kind: change.kind, data: change.data, fieldTimes: change.fieldTimes });
  }
}

/** Drops a comment's refused changes for good. */
export async function discardFailed(store: KeyValueStore, ownerId: string, commentId: string): Promise<void> {
  await updateCommentCache(store, ownerId, (cache) => withoutFailed(cache, (c) => c.entityId === commentId));
}
