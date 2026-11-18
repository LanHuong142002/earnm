import { useCallback, useEffect, useMemo, useState } from "react";

import { getToken } from "../../auth/token-store";
import { ApiError } from "../../lib/api";
import { newProjectId } from "../../projects/newProjectId";
import { useProjects } from "../../projects/ProjectsProvider";
import type { Change } from "../../sync/queue";
import { asyncStorageStore } from "../../sync/asyncStorageStore";
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
import { COMMENT_BATCH, bellFor, canEditComment, lengthCheck, nextShown, pageComments, type BellState, type CommentPage } from "./view";
import type { Parent } from "../parent";

export type CommentResult = { ok: true } | { ok: false; reason: "empty" | "too_long" | "not_ready" | "not_allowed" };

type Options = {
  /** The task or idea the comments belong to. */
  parent: Parent;
  /**
   * The signed-in person, from the session (`identity` of `useAuth()`: the saved copy counts while the profile
   * request is pending, so the screen never waits on the network to know who "me" is).
   */
  me: { id: string; displayName: string } | null;
};

export type ParentComments = {
  /** Every comment with waiting and failed changes laid over it, in no particular order. */
  comments: Comment[];
  /** The comments to show now, in the chosen order, a batch of 5 at a time. */
  page: CommentPage;
  /** How many comments the parent has (for the heading). */
  count: number;
  order: CommentOrder;
  setOrder: (order: CommentOrder) => void;
  /** "Xem thêm bình luận (N)": shows five more. */
  loadMore: () => void;
  /** The cache and the first fetch are not back yet and nothing is known. */
  loading: boolean;
  /** Nothing is cached and the last fetch did not get through: show the offline note. */
  unavailable: boolean;
  /** Whether the viewer may use the reminder flag (`parent.canFlag`): tasks only, for the creator and assignees. */
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

/** Loads, shows and changes one parent's comments. Changes go through the shared queue, so they work offline. */
export function useParentComments({ parent, me }: Options): ParentComments {
  const { projectId, id: parentId, comments: scope } = parent;
  const { sync } = useProjects();
  const { queue, afterEnqueue, onFlushed, runExclusive } = sync;
  const ownerId = me?.id ?? null;

  // Everything loaded is filed under the screen it was loaded for, so opening another task or idea starts clean.
  const key = `${ownerId}|${projectId}|${parentId}`;
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
    const [next, queued] = await Promise.all([loadCommentCache(asyncStorageStore, ownerId, scope), queue.waiting()]);
    setLocal({ key, cache: next, waiting: queued });
  }, [ownerId, queue, key, scope]);

  const fetchRemote = useCallback(async () => {
    if (ownerId === null) return;
    await runExclusive(async () => {
      await settleFailures();
      const token = await getToken();
      if (!token) return;
      try {
        const list = await scope.api.listComments(token, projectId, parentId);
        await updateCommentCache(
          asyncStorageStore,
          ownerId,
          (c) => {
            const stale = new Set(staleFailedIds(parentId, list, failedFor(c, parentId), scope.entity));
            return withoutFailed(setTaskComments(c, projectId, parentId, list), (f) => stale.has(f.changeId));
          },
          scope,
        );
        setRemote({ key, failed: false });
      } catch (e) {
        // Offline or refused: what is cached stays on screen. A signed-out answer is handled by the sync cycle.
        setRemote({ key, failed: !(e instanceof ApiError) || e.status !== 404 });
      }
    }).catch(() => setRemote({ key, failed: true }));
  }, [ownerId, projectId, parentId, runExclusive, key, scope]);

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

  const server = cache ? commentsFor(cache, parentId) : null;
  const failed = useMemo(() => (cache ? failedFor(cache, parentId) : []), [cache, parentId]);
  const comments = useMemo(
    () => applyCommentOverlay(parentId, server ?? [], waiting, failed, scope.entity),
    [parentId, server, waiting, failed, scope.entity],
  );
  const page = useMemo(() => pageComments(comments, order, shown), [comments, order, shown]);
  const involved = parent.canFlag === true;

  const record = useCallback(
    async (change: Parameters<typeof queue.enqueue>[0]) => {
      await queue.enqueue(change);
      await readLocal();
      await afterEnqueue();
    },
    [queue, readLocal, afterEnqueue],
  );

  const ready = ownerId !== null && cache !== null;

  const add = useCallback<ParentComments["add"]>(
    async (text, remindWith) => {
      if (!me || !ready) return { ok: false, reason: "not_ready" };
      const check = lengthCheck(text);
      if (check.empty) return { ok: false, reason: "empty" };
      if (check.over > 0) return { ok: false, reason: "too_long" };
      // Only involved people set the flag, also on a new comment.
      const flag = remindWith && involved;
      await record(
        commentCreateChange({
          projectId,
          taskId: parentId,
          entity: scope.entity,
          id: newProjectId(),
          text: text.trim(),
          remindWith: flag,
          author: me,
          now: new Date(),
        }),
      );
      return { ok: true };
    },
    [me, ready, involved, record, projectId, parentId, scope.entity],
  );

  const edit = useCallback<ParentComments["edit"]>(
    async (commentId, text) => {
      const comment = comments.find((c) => c.id === commentId);
      if (!ready || !comment) return { ok: false, reason: "not_ready" };
      if (!canEditComment(comment, ownerId) || comment.state === "failed") return { ok: false, reason: "not_allowed" };
      const check = lengthCheck(text);
      if (check.empty) return { ok: false, reason: "empty" };
      if (check.over > 0) return { ok: false, reason: "too_long" };
      if (text.trim() !== comment.text) await record(commentTextChange({ projectId, taskId: parentId, entity: scope.entity, id: commentId, text: text.trim(), now: new Date() }));
      return { ok: true };
    },
    [ready, ownerId, comments, record, projectId, parentId, scope.entity],
  );

  const remove = useCallback<ParentComments["remove"]>(
    async (commentId) => {
      const comment = comments.find((c) => c.id === commentId);
      if (!ready || !ownerId || !comment) return { ok: false, reason: "not_ready" };
      if (!canEditComment(comment, ownerId)) return { ok: false, reason: "not_allowed" };
      // Refused changes of this comment are moot once it is deleted.
      await discardFailed(asyncStorageStore, ownerId, commentId, scope);
      const onServer = server?.some((c) => c.id === commentId) ?? false;
      if (comment.state !== "failed" || onServer) await record(commentDeleteChange({ projectId, taskId: parentId, entity: scope.entity, id: commentId }));
      else await readLocal();
      return { ok: true };
    },
    [ready, ownerId, comments, server, record, readLocal, projectId, parentId, scope],
  );

  const toggleRemind = useCallback<ParentComments["toggleRemind"]>(
    async (commentId) => {
      const comment = comments.find((c) => c.id === commentId);
      if (!ready || !comment) return { ok: false, reason: "not_ready" };
      if (!involved || comment.state === "failed") return { ok: false, reason: "not_allowed" };
      await record(commentRemindChange({ projectId, taskId: parentId, entity: scope.entity, id: commentId, remindWith: !comment.remindWith, now: new Date() }));
      return { ok: true };
    },
    [ready, involved, comments, record, projectId, parentId, scope.entity],
  );

  const retry = useCallback(
    async (commentId: string) => {
      if (ownerId === null) return;
      await retryFailed(queue, asyncStorageStore, ownerId, commentId, scope);
      await readLocal();
      await afterEnqueue();
    },
    [ownerId, queue, readLocal, afterEnqueue, scope],
  );

  const discard = useCallback(
    async (commentId: string) => {
      if (ownerId === null) return;
      await discardFailed(asyncStorageStore, ownerId, commentId, scope);
      await readLocal();
    },
    [ownerId, readLocal, scope],
  );

  const setOrder = useCallback((next: CommentOrder) => {
    setOrderState(next);
    // Changing the order goes back to the first batch (spec R19).
    setMore(null);
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
    bell: (comment) => bellFor(parent.canFlag, comment.remindWith),
  };
}
