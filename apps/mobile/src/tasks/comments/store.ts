import type { Change } from "../../sync/queue";
import type { KeyValueStore } from "../../sync/storage";
import { COMMENT_ENTITY } from "../entities";
import type { CommentOrder, ServerComment } from "./types";

const CACHE_KEY = "comments.cache.v1";
const SORT_KEY = "comments.sort.v1";

/** One task's comments as the server last sent them, filed under their project so they are pruned with it. */
export type CachedTaskComments = { projectId: string; comments: ServerComment[] };

export type CommentCache = {
  ownerId: string;
  byTask: Record<string, CachedTaskComments>;
  /** Changes the server refused for good. They wait for the person to retry or discard them. */
  failed: Change[];
};

export function emptyCommentCache(ownerId: string): CommentCache {
  return { ownerId, byTask: {}, failed: [] };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isServerComment(v: unknown): v is ServerComment {
  if (!isRecord(v)) return false;
  const author = v.author;
  const authorOk = author === null || (isRecord(author) && typeof author.id === "string" && typeof author.displayName === "string");
  return (
    typeof v.id === "string" &&
    typeof v.taskId === "string" &&
    authorOk &&
    typeof v.text === "string" &&
    typeof v.edited === "boolean" &&
    typeof v.remindWith === "boolean" &&
    typeof v.createdAt === "string"
  );
}

function isFailedChange(v: unknown): v is Change {
  return (
    isRecord(v) &&
    typeof v.changeId === "string" &&
    v.entity === COMMENT_ENTITY &&
    typeof v.entityId === "string" &&
    (v.kind === "create" || v.kind === "update" || v.kind === "delete") &&
    isRecord(v.data) &&
    isRecord(v.fieldTimes) &&
    typeof v.createdAt === "string"
  );
}

function parse(raw: unknown, ownerId: string): CommentCache {
  if (!isRecord(raw) || raw.ownerId !== ownerId) return emptyCommentCache(ownerId);
  const byTask: Record<string, CachedTaskComments> = {};
  if (isRecord(raw.byTask)) {
    for (const [taskId, entry] of Object.entries(raw.byTask)) {
      // One bad entry makes only that task's copy untrusted; it is fetched again.
      if (isRecord(entry) && typeof entry.projectId === "string" && Array.isArray(entry.comments) && entry.comments.every(isServerComment)) {
        byTask[taskId] = { projectId: entry.projectId, comments: entry.comments };
      }
    }
  }
  const failed = Array.isArray(raw.failed) ? raw.failed.filter(isFailedChange) : [];
  return { ownerId, byTask, failed };
}

/** The saved cache of `ownerId`; empty when there is none, it is someone else's, or it cannot be read. */
export async function loadCommentCache(store: KeyValueStore, ownerId: string): Promise<CommentCache> {
  try {
    return parse(await store.getJSON<unknown>(CACHE_KEY), ownerId);
  } catch {
    return emptyCommentCache(ownerId);
  }
}

export function clearCommentCache(store: KeyValueStore): Promise<void> {
  return store.remove(CACHE_KEY);
}

const NO_COMMENTS = null;

/** The cached comments of a task; null when it was never fetched (so "no comments" and "not known" differ). */
export function commentsFor(cache: CommentCache, taskId: string): ServerComment[] | null {
  return cache.byTask[taskId]?.comments ?? NO_COMMENTS;
}

export function setTaskComments(cache: CommentCache, projectId: string, taskId: string, comments: ServerComment[]): CommentCache {
  return { ...cache, byTask: { ...cache.byTask, [taskId]: { projectId, comments } } };
}

/** Drops the comments and refused changes of projects that are no longer in `projectIds`. */
export function pruneCommentCache(cache: CommentCache, projectIds: string[]): CommentCache {
  const keep = new Set(projectIds);
  return {
    ...cache,
    byTask: Object.fromEntries(Object.entries(cache.byTask).filter(([, entry]) => keep.has(entry.projectId))),
    failed: cache.failed.filter((c) => keep.has(String(c.data.projectId))),
  };
}

/** Keeps a refused change (without its send count) for its comment. The same change is kept once. */
export function recordFailed(cache: CommentCache, change: Change): CommentCache {
  if (cache.failed.some((c) => c.changeId === change.changeId)) return cache;
  const { attempts: _attempts, ...kept } = change;
  return { ...cache, failed: [...cache.failed, kept] };
}

export function withoutFailed(cache: CommentCache, drop: (change: Change) => boolean): CommentCache {
  return { ...cache, failed: cache.failed.filter((c) => !drop(c)) };
}

export const failedFor = (cache: CommentCache, taskId: string): Change[] => cache.failed.filter((c) => c.data.taskId === taskId);

// Readers and writers (the queue's refusal handler, the screen) share one key, so every write reads
// the latest copy and writes behind the previous write.
const chains = new WeakMap<KeyValueStore, Promise<unknown>>();
const listeners = new Set<() => void>();

/** Runs `listener` after every write to the comment cache. Returns an unsubscribe function. */
export function subscribeComments(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads the cache, applies `change`, saves it and tells the listeners. Writes run one after another. Resolves to the saved cache. */
export function updateCommentCache(store: KeyValueStore, ownerId: string, change: (cache: CommentCache) => CommentCache): Promise<CommentCache> {
  const run = async () => {
    const next = change(await loadCommentCache(store, ownerId));
    await store.setJSON(CACHE_KEY, next);
    for (const listener of [...listeners]) listener();
    return next;
  };
  const previous = chains.get(store) ?? Promise.resolve();
  const result = previous.then(run, run);
  chains.set(store, result.catch(() => {}));
  return result;
}

/** The sort order saved on this device (spec R19). Newest first until the person chooses. */
export async function loadSortOrder(store: KeyValueStore): Promise<CommentOrder> {
  try {
    const saved = await store.getJSON<unknown>(SORT_KEY);
    return saved === "oldest" ? "oldest" : "newest";
  } catch {
    return "newest";
  }
}

export function saveSortOrder(store: KeyValueStore, order: CommentOrder): Promise<void> {
  return store.setJSON(SORT_KEY, order);
}
