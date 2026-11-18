import type { Change } from "../../sync/queue";
import type { KeyValueStore } from "../../sync/storage";
import { PHOTO_ENTITY, PHOTO_UPLOAD_ENTITY } from "../entities";
import type { ServerPhoto } from "./types";

const CACHE_KEY = "photos.cache.v1";

/** One task's photos as the server last sent them, filed under their project so they are pruned with it. */
export type CachedTaskPhotos = { projectId: string; photos: ServerPhoto[] };

export type PhotoCache = {
  ownerId: string;
  byTask: Record<string, CachedTaskPhotos>;
  /** Changes the server refused for good. They wait for the person to retry or discard them. */
  failed: Change[];
};

export function emptyPhotoCache(ownerId: string): PhotoCache {
  return { ownerId, byTask: {}, failed: [] };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isServerPhoto(v: unknown): v is ServerPhoto {
  if (!isRecord(v)) return false;
  const by = v.addedBy;
  const byOk = by === null || (isRecord(by) && typeof by.id === "string" && typeof by.displayName === "string");
  return (
    typeof v.id === "string" &&
    typeof v.taskId === "string" &&
    byOk &&
    typeof v.caption === "string" &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    typeof v.createdAt === "string" &&
    typeof v.thumbUrl === "string" &&
    typeof v.url === "string"
  );
}

function isFailedChange(v: unknown): v is Change {
  return (
    isRecord(v) &&
    typeof v.changeId === "string" &&
    (v.entity === PHOTO_UPLOAD_ENTITY || v.entity === PHOTO_ENTITY) &&
    typeof v.entityId === "string" &&
    (v.kind === "create" || v.kind === "update" || v.kind === "delete") &&
    isRecord(v.data) &&
    isRecord(v.fieldTimes) &&
    typeof v.createdAt === "string"
  );
}

function parse(raw: unknown, ownerId: string): PhotoCache {
  if (!isRecord(raw) || raw.ownerId !== ownerId) return emptyPhotoCache(ownerId);
  const byTask: Record<string, CachedTaskPhotos> = {};
  if (isRecord(raw.byTask)) {
    for (const [taskId, entry] of Object.entries(raw.byTask)) {
      // One bad entry makes only that task's copy untrusted; it is fetched again.
      if (isRecord(entry) && typeof entry.projectId === "string" && Array.isArray(entry.photos) && entry.photos.every(isServerPhoto)) {
        byTask[taskId] = { projectId: entry.projectId, photos: entry.photos };
      }
    }
  }
  const failed = Array.isArray(raw.failed) ? raw.failed.filter(isFailedChange) : [];
  return { ownerId, byTask, failed };
}

/** The saved cache of `ownerId`; empty when there is none, it is someone else's, or it cannot be read. */
export async function loadPhotoCache(store: KeyValueStore, ownerId: string): Promise<PhotoCache> {
  try {
    return parse(await store.getJSON<unknown>(CACHE_KEY), ownerId);
  } catch {
    return emptyPhotoCache(ownerId);
  }
}

export function clearPhotoCache(store: KeyValueStore): Promise<void> {
  return store.remove(CACHE_KEY);
}

/** The cached photos of a task; null when it was never fetched (so "no photos" and "not known" differ). */
export function photosFor(cache: PhotoCache, taskId: string): ServerPhoto[] | null {
  return cache.byTask[taskId]?.photos ?? null;
}

export function setTaskPhotos(cache: PhotoCache, projectId: string, taskId: string, photos: ServerPhoto[]): PhotoCache {
  return { ...cache, byTask: { ...cache.byTask, [taskId]: { projectId, photos } } };
}

/** Drops the photos and refused changes of projects that are no longer in `projectIds`. */
export function prunePhotoCache(cache: PhotoCache, projectIds: string[]): PhotoCache {
  const keep = new Set(projectIds);
  return {
    ...cache,
    byTask: Object.fromEntries(Object.entries(cache.byTask).filter(([, entry]) => keep.has(entry.projectId))),
    failed: cache.failed.filter((c) => keep.has(String(c.data.projectId))),
  };
}

/** Keeps a refused change (without its send count) for its photo. The same change is kept once. */
export function recordFailed(cache: PhotoCache, change: Change): PhotoCache {
  if (cache.failed.some((c) => c.changeId === change.changeId)) return cache;
  const { attempts: _attempts, ...kept } = change;
  return { ...cache, failed: [...cache.failed, kept] };
}

export function withoutFailed(cache: PhotoCache, drop: (change: Change) => boolean): PhotoCache {
  return { ...cache, failed: cache.failed.filter((c) => !drop(c)) };
}

export const failedFor = (cache: PhotoCache, taskId: string): Change[] => cache.failed.filter((c) => c.data.taskId === taskId);

// Readers and writers (the queue's refusal handler, the screen) share one key, so every write reads
// the latest copy and writes behind the previous write.
const chains = new WeakMap<KeyValueStore, Promise<unknown>>();
const listeners = new Set<() => void>();

/** Runs `listener` after every write to the photo cache, or when an upload starts or ends. Returns an unsubscribe function. */
export function subscribePhotos(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyPhotos(): void {
  for (const listener of [...listeners]) listener();
}

/** Reads the cache, applies `change`, saves it and tells the listeners. Writes run one after another. Resolves to the saved cache. */
export function updatePhotoCache(store: KeyValueStore, ownerId: string, change: (cache: PhotoCache) => PhotoCache): Promise<PhotoCache> {
  const run = async () => {
    const next = change(await loadPhotoCache(store, ownerId));
    await store.setJSON(CACHE_KEY, next);
    notifyPhotos();
    return next;
  };
  const previous = chains.get(store) ?? Promise.resolve();
  const result = previous.then(run, run);
  chains.set(store, result.catch(() => {}));
  return result;
}
