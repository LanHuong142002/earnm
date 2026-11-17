import { useCallback, useEffect, useMemo, useState } from "react";

import { getToken } from "../../auth/token-store";
import { ApiError } from "../../lib/api";
import { newProjectId } from "../../projects/newProjectId";
import { useProjects } from "../../projects/ProjectsProvider";
import type { Change } from "../../sync/queue";
import { asyncStorageStore } from "../../sync/asyncStorageStore";
import { listComments } from "./api";
import { applyCommentOverlay, staleFailedIds } from "./overlay";
import {
  commentsFor,
  failedFor,
  loadCommentCache,
  loadSortOrder,
  saveSortOrder,
  setTaskComments,
  subscribeComments,
  updateCommentCache,
  withoutFailed,
  type CommentCache,
} from "./store";
import {
  commentCreateChange,
  commentDeleteChange,
  commentRemindChange,
  commentTextChange,
  discardFailed,
  retryFailed,
  settleFailures,
} from "./sync";
import type { Comment, CommentOrder } from "./types";
import { COMMENT_BATCH, bellState, canEditComment, isInvolved, lengthCheck, nextShown, pageComments, type BellState, type CommentPage } from "./view";
import type { Task } from "../types";

export type CommentResult = { ok: true } | { ok: false; reason: "empty" | "too_long" | "not_ready" | "not_allowed" };

type Options = {
  projectId: string;
  taskId: string;
  /**
   * The signed-in person, from the session (`identity` of `useAuth()`: the saved copy counts while the profile
   * request is pending, so the screen never waits on the network to know who "me" is).
   */
  me: { id: string; displayName: string } | null;
  /** The task, to know who is involved. Null while it is not known. */
  task: Pick<Task, "createdById" | "assignees"> | null;
};

export type TaskComments = {
  /** Every comment with waiting and failed changes laid over it, in no particular order. */
  comments: Comment[];
  /** The comments to show now, in the chosen order, a batch of 5 at a time. */
  page: CommentPage;
  /** How many comments the task has (for the heading). */
  count: number;
  order: CommentOrder;
  setOrder: (order: CommentOrder) => void;
  /** "Xem thêm bình luận (N)": shows five more. */
  loadMore: () => void;
  /** The cache and the first fetch are not back yet and nothing is known. */
  loading: boolean;
  /** Nothing is cached and the last fetch did not get through: show the offline note. */
  unavailable: boolean;
  /** Whether the viewer is the task's creator or an assignee, who may use the reminder flag. */
  involved: boolean;
  add: (text: string, remindWith: boolean) => Promise<CommentResult>;
  edit: (commentId: string, text: string) => Promise<CommentResult>;
  remove: (commentId: string) => Promise<CommentResult>;
  /** Flips the reminder flag. Involved people only. */
  toggleRemind: (commentId: string) => Promise<CommentResult>;
  /** Sends a failed comment's changes again. */
  retry: (commentId: string) => Promise<void>;
  /** Drops a failed comment's changes. */
  discard: (commentId: string) => Promise<void>;
  /** Whether "Sửa · Xoá" shows: the author's own comment that is not failed (a failed one offers Thử lại · Bỏ). */
  canEdit: (comment: Comment) => boolean;
  bell: (comment: Comment) => BellState;
};

/** Loads, shows and changes one task's comments. Changes go through the shared queue, so they work offline. */
export function useTaskComments({ projectId, taskId, me, task }: Options): TaskComments {
  const { sync } = useProjects();
  const { queue, afterEnqueue, onFlushed, runExclusive } = sync;
  const ownerId = me?.id ?? null;

  // Everything loaded is filed under the screen it was loaded for, so opening another task starts clean.
  const key = `${ownerId}|${projectId}|${taskId}`;
  const [local, setLocal] = useState<{ key: string; cache: CommentCache; waiting: Change[] } | null>(null);
  const [remote, setRemote] = useState<{ key: string; failed: boolean } | null>(null);
  const [more, setMore] = useState<{ key: string; shown: number } | null>(null);
  const [order, setOrderState] = useState<CommentOrder>("newest");
  const cache = local?.key === key ? local.cache : null;
  const waiting = useMemo(() => (local?.key === key ? local.waiting : []), [local, key]);
  const fetched = remote?.key === key;
  const fetchFailed = fetched && remote.failed;
  const shown = more?.key === key ? more.shown : COMMENT_BATCH;

  const readLocal = useCallback(async () => {
    if (ownerId === null) return;
    const [next, queued] = await Promise.all([loadCommentCache(asyncStorageStore, ownerId), queue.waiting()]);
    setLocal({ key, cache: next, waiting: queued });
  }, [ownerId, queue, key]);

  const fetchRemote = useCallback(async () => {
    if (ownerId === null) return;
    await runExclusive(async () => {
      await settleFailures();
      const token = await getToken();
      if (!token) return;
      try {
        const list = await listComments(token, projectId, taskId);
        await updateCommentCache(asyncStorageStore, ownerId, (c) => {
          const stale = new Set(staleFailedIds(taskId, list, failedFor(c, taskId)));
          return withoutFailed(setTaskComments(c, projectId, taskId, list), (f) => stale.has(f.changeId));
        });
        setRemote({ key, failed: false });
      } catch (e) {
        // Offline or refused: what is cached stays on screen. A signed-out answer is handled by the sync cycle.
        setRemote({ key, failed: !(e instanceof ApiError) || e.status !== 404 });
      }
    }).catch(() => setRemote({ key, failed: true }));
  }, [ownerId, projectId, taskId, runExclusive, key]);

  // Open: show the cache, then fetch. Whatever changes the cache or the queue later is read again.
  useEffect(() => {
    let live = true;
    void loadSortOrder(asyncStorageStore).then((o) => live && setOrderState(o));
    void Promise.resolve().then(readLocal).then(() => live && void fetchRemote());
    const off = subscribeComments(() => void readLocal());
    // After each sync pass the server list is fetched again, so what was sent shows as sent.
    const offFlush = onFlushed(() => void fetchRemote());
    return () => {
      live = false;
      off();
      offFlush();
    };
  }, [readLocal, fetchRemote, onFlushed]);

  const server = cache ? commentsFor(cache, taskId) : null;
  const failed = useMemo(() => (cache ? failedFor(cache, taskId) : []), [cache, taskId]);
  const comments = useMemo(() => applyCommentOverlay(taskId, server ?? [], waiting, failed), [taskId, server, waiting, failed]);
  const page = useMemo(() => pageComments(comments, order, shown), [comments, order, shown]);
  const involved = task !== null && isInvolved(task, ownerId);

  const record = useCallback(
    async (change: Parameters<typeof queue.enqueue>[0]) => {
      await queue.enqueue(change);
      await readLocal();
      await afterEnqueue();
    },
    [queue, readLocal, afterEnqueue],
  );

  const ready = ownerId !== null && cache !== null;

  const add = useCallback<TaskComments["add"]>(
    async (text, remindWith) => {
      if (!me || !ready) return { ok: false, reason: "not_ready" };
      const check = lengthCheck(text);
      if (check.empty) return { ok: false, reason: "empty" };
      if (check.over > 0) return { ok: false, reason: "too_long" };
      // Only involved people set the flag, also on a new comment.
      const flag = remindWith && involved;
      await record(
        commentCreateChange({ projectId, taskId, id: newProjectId(), text: text.trim(), remindWith: flag, author: me, now: new Date() }),
      );
      return { ok: true };
    },
    [me, ready, involved, record, projectId, taskId],
  );

  const edit = useCallback<TaskComments["edit"]>(
    async (commentId, text) => {
      const comment = comments.find((c) => c.id === commentId);
      if (!ready || !comment) return { ok: false, reason: "not_ready" };
      if (!canEditComment(comment, ownerId) || comment.state === "failed") return { ok: false, reason: "not_allowed" };
      const check = lengthCheck(text);
      if (check.empty) return { ok: false, reason: "empty" };
      if (check.over > 0) return { ok: false, reason: "too_long" };
      if (text.trim() !== comment.text) await record(commentTextChange({ projectId, taskId, id: commentId, text: text.trim(), now: new Date() }));
      return { ok: true };
    },
    [ready, ownerId, comments, record, projectId, taskId],
  );

  const remove = useCallback<TaskComments["remove"]>(
    async (commentId) => {
      const comment = comments.find((c) => c.id === commentId);
      if (!ready || !ownerId || !comment) return { ok: false, reason: "not_ready" };
      if (!canEditComment(comment, ownerId)) return { ok: false, reason: "not_allowed" };
      // Refused changes of this comment are moot once it is deleted.
      await discardFailed(asyncStorageStore, ownerId, commentId);
      const onServer = server?.some((c) => c.id === commentId) ?? false;
      if (comment.state !== "failed" || onServer) await record(commentDeleteChange({ projectId, taskId, id: commentId }));
      else await readLocal();
      return { ok: true };
    },
    [ready, ownerId, comments, server, record, readLocal, projectId, taskId],
  );

  const toggleRemind = useCallback<TaskComments["toggleRemind"]>(
    async (commentId) => {
      const comment = comments.find((c) => c.id === commentId);
      if (!ready || !comment) return { ok: false, reason: "not_ready" };
      if (!involved || comment.state === "failed") return { ok: false, reason: "not_allowed" };
      await record(commentRemindChange({ projectId, taskId, id: commentId, remindWith: !comment.remindWith, now: new Date() }));
      return { ok: true };
    },
    [ready, involved, comments, record, projectId, taskId],
  );

  const retry = useCallback(
    async (commentId: string) => {
      if (ownerId === null) return;
      await retryFailed(queue, asyncStorageStore, ownerId, commentId);
      await readLocal();
      await afterEnqueue();
    },
    [ownerId, queue, readLocal, afterEnqueue],
  );

  const discard = useCallback(
    async (commentId: string) => {
      if (ownerId === null) return;
      await discardFailed(asyncStorageStore, ownerId, commentId);
      await readLocal();
    },
    [ownerId, readLocal],
  );

  const setOrder = useCallback((next: CommentOrder) => {
    setOrderState(next);
    void saveSortOrder(asyncStorageStore, next).catch(() => {});
  }, []);

  const loadMore = useCallback(() => setMore({ key, shown: nextShown(shown, comments.length) }), [key, shown, comments.length]);

  return {
    comments,
    page,
    count: comments.length,
    order,
    setOrder,
    loadMore,
    loading: !fetched && server === null,
    unavailable: fetched && fetchFailed && server === null && comments.length === 0,
    involved,
    add,
    edit,
    remove,
    toggleRemind,
    retry,
    discard,
    canEdit: (comment) => canEditComment(comment, ownerId) && comment.state !== "failed",
    bell: (comment) => bellState(comment.remindWith, involved),
  };
}
