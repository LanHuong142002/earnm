import type { Change } from "../../sync/queue";
import { COMMENT_ENTITY } from "../entities";
import type { Comment, CommentState, ServerComment } from "./types";

const forTask = (taskId: string, change: Change, entity: string) => change.entity === entity && change.data.taskId === taskId;

const RANK: Record<CommentState, number> = { synced: 0, waiting: 1, failed: 2 };
const stronger = (a: CommentState, b: CommentState): CommentState => (RANK[a] >= RANK[b] ? a : b);

function apply(list: Comment[], change: Change, state: CommentState): Comment[] {
  const { data } = change;
  const index = list.findIndex((c) => c.id === change.entityId);
  if (change.kind === "delete") {
    if (index === -1) return list;
    // A waiting delete hides the comment; a refused one leaves it on screen, marked.
    if (state === "waiting") return list.filter((c) => c.id !== change.entityId);
    return list.map((c, i) => (i === index ? { ...c, state: stronger(c.state, state) } : c));
  }
  if (change.kind === "update") {
    if (index === -1) return list;
    return list.map((c, i) => {
      if (i !== index) return c;
      const next: Comment = { ...c, state: stronger(c.state, state) };
      if (typeof data.text === "string") {
        next.text = data.text;
        next.edited = true;
      }
      if (typeof data.remindWith === "boolean") next.remindWith = data.remindWith;
      return next;
    });
  }
  if (index !== -1) return list; // the server already has it
  const authorId = typeof data.authorId === "string" ? data.authorId : null;
  const added: Comment = {
    id: change.entityId,
    taskId: String(data.taskId),
    author: authorId === null ? null : { id: authorId, displayName: typeof data.authorName === "string" ? data.authorName : "" },
    text: typeof data.text === "string" ? data.text : "",
    edited: false,
    remindWith: data.remindWith === true,
    createdAt: change.createdAt,
    state,
  };
  return [...list, added];
}

/**
 * The comments of one task as the screen shows them: the server's list with the failed changes and then the
 * waiting ones laid over it. A waiting create is a waiting comment, a waiting edit shows its new value, a
 * waiting delete hides the comment, and a refused change leaves the comment on screen as failed. A comment
 * with both a refused and a waiting change shows failed. Changes for a comment that is not there are ignored.
 */
export function applyCommentOverlay(
  taskId: string,
  serverList: ServerComment[],
  waiting: Change[],
  failed: Change[],
  entity: string = COMMENT_ENTITY,
): Comment[] {
  let list: Comment[] = serverList.map((c) => ({ ...c, state: "synced" as const }));
  for (const change of failed) if (forTask(taskId, change, entity)) list = apply(list, change, "failed");
  for (const change of waiting) if (forTask(taskId, change, entity)) list = apply(list, change, "waiting");
  return list;
}

/**
 * Failed edits and deletes whose comment is gone from the server's list (deleted elsewhere): nothing can
 * retry them, so they should be dropped. A failed create, or an edit of one, is never stale.
 */
export function staleFailedIds(taskId: string, serverList: ServerComment[], failed: Change[], entity: string = COMMENT_ENTITY): string[] {
  const known = new Set(serverList.map((c) => c.id));
  for (const change of failed) if (forTask(taskId, change, entity) && change.kind === "create") known.add(change.entityId);
  return failed.filter((c) => forTask(taskId, c, entity) && c.kind !== "create" && !known.has(c.entityId)).map((c) => c.changeId);
}
