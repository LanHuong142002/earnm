import { useCallback, useEffect, useMemo, useState } from "react";

import { getToken } from "../../auth/token-store";
import { ApiError } from "../../lib/api";
import { newProjectId } from "../../projects/newProjectId";
import { useProjects } from "../../projects/ProjectsProvider";
import type { Change } from "../../sync/queue";
import { asyncStorageStore } from "../../sync/asyncStorageStore";
import type { Task } from "../types";
import { listPhotos } from "./api";
import { applyPhotoOverlay, staleFailedIds } from "./overlay";
import { preparePhoto, type PickedPhoto } from "./prepare";
import { pendingFiles, prepareDeps } from "./realDeps";
import {
  failedFor,
  loadPhotoCache,
  photosFor,
  setTaskPhotos,
  subscribePhotos,
  updatePhotoCache,
  withoutFailed,
  type PhotoCache,
} from "./store";
import type { Photo } from "./types";
import {
  cancelUpload,
  discardFailed,
  photoCaptionChange,
  photoDeleteChange,
  photoUploadChange,
  retryFailed,
  settleFailures,
  uploadingIds,
} from "./uploads";
import {
  acceptPicks,
  addState,
  canCaption,
  canRemove,
  captionCheck,
  freePlaces,
  gridOf,
  isInvolved,
  photoCount,
  showSection,
  sortPhotos,
  type AddState,
  type Grid,
} from "./view";

/** What `add` did with the photos it was given. */
export type AddResult =
  | { ok: true; added: number; /** Left out because the task has no place for them. */ dropped: number; /** Could not be prepared (unreadable file). */ failed: number }
  | { ok: false; reason: "not_ready" | "not_allowed" | "full" };

export type PhotoResult = { ok: true } | { ok: false; reason: "too_long" | "not_ready" | "not_allowed" };

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

export type TaskPhotos = {
  /** Every photo, oldest first: the server's, with waiting, uploading and failed ones and queued changes laid over them. */
  photos: Photo[];
  /** The x of "x/10": uploaded, waiting and uploading photos (a failed upload holds no place). */
  count: number;
  /** How many more photos the task takes; the picker's `selectionLimit`. */
  freePlaces: number;
  /** At most 8 thumbnails, and the N of "+N" for the 8th (0 when there is none). */
  grid: Grid;
  /** The cache and the first fetch are not back yet and nothing is known. */
  loading: boolean;
  /** The API answered 503: Cloudinary is not set up. Show the "photos unavailable" note; adding is hidden meanwhile. */
  unavailable: boolean;
  /** Nothing is cached and the last fetch did not get through (offline). */
  offline: boolean;
  /** Whether the viewer is the task's creator or an assignee. */
  involved: boolean;
  /** "＋ Thêm": hidden, open, or full (disabled with the "Đủ 10 ảnh" line). Hidden too while photos are unavailable. */
  addState: AddState;
  /** False for a member who is not involved and has no photos to see: the whole section is left out. */
  showSection: boolean;
  /** Prepares the picked photos (1600 px JPEG), keeps them on the phone and queues their upload. Never more than the free places. */
  add: (picked: PickedPhoto[]) => Promise<AddResult>;
  /** Deletes an uploaded photo, or drops one that waits or failed. The screen confirms first. */
  remove: (photoId: string) => Promise<PhotoResult>;
  /** Saves a caption (empty clears it). */
  setCaption: (photoId: string, text: string) => Promise<PhotoResult>;
  /** Sends a failed photo's changes again. */
  retry: (photoId: string) => Promise<void>;
  /** Drops a failed photo's changes; a failed upload's local file is deleted. */
  discard: (photoId: string) => Promise<void>;
  canRemove: (photo: Photo) => boolean;
  canCaption: (photo: Photo) => boolean;
};

/** Loads, shows and changes one task's photos. Changes go through the shared queue, so they work offline. */
export function useTaskPhotos({ projectId, taskId, me, task }: Options): TaskPhotos {
  const { sync } = useProjects();
  const { queue, afterEnqueue, onFlushed, runExclusive } = sync;
  const ownerId = me?.id ?? null;

  // Everything loaded is filed under the screen it was loaded for, so opening another task starts clean.
  const key = `${ownerId}|${projectId}|${taskId}`;
  const [local, setLocal] = useState<{ key: string; cache: PhotoCache; waiting: Change[]; uploading: ReadonlySet<string> } | null>(null);
  const [remote, setRemote] = useState<{ key: string; failed: boolean; unavailable: boolean } | null>(null);
  const cache = local?.key === key ? local.cache : null;
  const waiting = useMemo(() => (local?.key === key ? local.waiting : []), [local, key]);
  const uploading = useMemo(() => (local?.key === key ? local.uploading : new Set<string>()), [local, key]);
  const fetched = remote?.key === key;
  const fetchFailed = fetched && remote.failed;
  const unavailable = fetched && remote.unavailable;

  const readLocal = useCallback(async () => {
    if (ownerId === null) return;
    const [next, queued] = await Promise.all([loadPhotoCache(asyncStorageStore, ownerId), queue.waiting()]);
    setLocal({ key, cache: next, waiting: queued, uploading: uploadingIds() });
  }, [ownerId, queue, key]);

  const fetchRemote = useCallback(async () => {
    if (ownerId === null) return;
    await runExclusive(async () => {
      await settleFailures();
      const token = await getToken();
      if (!token) return;
      try {
        const list = await listPhotos(token, projectId, taskId);
        await updatePhotoCache(asyncStorageStore, ownerId, (c) => {
          const stale = new Set(staleFailedIds(taskId, list, failedFor(c, taskId)));
          return withoutFailed(setTaskPhotos(c, projectId, taskId, list), (f) => stale.has(f.changeId));
        });
        setRemote({ key, failed: false, unavailable: false });
      } catch (e) {
        // Offline or refused: what is cached stays on screen. A signed-out answer is handled by the sync cycle.
        const notSetUp = e instanceof ApiError && e.status === 503 && e.code === "photos_unavailable";
        setRemote({ key, failed: !(e instanceof ApiError) || e.status !== 404, unavailable: notSetUp });
      }
    }).catch(() => setRemote({ key, failed: true, unavailable: false }));
  }, [ownerId, projectId, taskId, runExclusive, key]);

  // Open: show the cache, then fetch. Whatever changes the cache, the queue or an upload later is read again.
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(readLocal).then(() => live && void fetchRemote());
    const off = subscribePhotos(() => void readLocal());
    // After each sync pass the server list is fetched again, so what was sent shows as sent.
    const offFlush = onFlushed(() => void fetchRemote());
    return () => {
      live = false;
      off();
      offFlush();
    };
  }, [readLocal, fetchRemote, onFlushed]);

  const server = cache ? photosFor(cache, taskId) : null;
  const failed = useMemo(() => (cache ? failedFor(cache, taskId) : []), [cache, taskId]);
  const photos = useMemo(
    () => sortPhotos(applyPhotoOverlay(taskId, server ?? [], waiting, failed, { uploading, localUri: pendingFiles.uriFor })),
    [taskId, server, waiting, failed, uploading],
  );
  const involved = task !== null && isInvolved(task, ownerId);
  const ready = ownerId !== null && cache !== null;

  const record = useCallback(
    async (change: Parameters<typeof queue.enqueue>[0]) => {
      await queue.enqueue(change);
      await readLocal();
      await afterEnqueue();
    },
    [queue, readLocal, afterEnqueue],
  );

  const add = useCallback<TaskPhotos["add"]>(
    async (picked) => {
      if (!me || !ready) return { ok: false, reason: "not_ready" };
      if (!involved || unavailable) return { ok: false, reason: "not_allowed" };
      const { take, dropped } = acceptPicks(picked.length, freePlaces(photos));
      if (take === 0) return { ok: false, reason: "full" };
      let added = 0;
      let unreadable = 0;
      for (const source of picked.slice(0, take)) {
        const id = newProjectId();
        try {
          const prepared = await preparePhoto(source, id, prepareDeps);
          await queue.enqueue(
            photoUploadChange({ projectId, taskId, id, width: prepared.width, height: prepared.height, author: me, now: new Date() }),
          );
          added += 1;
        } catch {
          // The file could not be read or saved; the queue holds nothing for it, so drop any half-made copy.
          pendingFiles.remove(id);
          unreadable += 1;
        }
      }
      await readLocal();
      if (added > 0) await afterEnqueue();
      return { ok: true, added, dropped, failed: unreadable };
    },
    [me, ready, involved, unavailable, photos, queue, projectId, taskId, readLocal, afterEnqueue],
  );

  const remove = useCallback<TaskPhotos["remove"]>(
    async (photoId) => {
      const photo = photos.find((p) => p.id === photoId);
      if (!ready || !ownerId || !photo) return { ok: false, reason: "not_ready" };
      if (!canRemove(involved, photo)) return { ok: false, reason: "not_allowed" };
      if (photo.state === "waiting" || photo.state === "failed") {
        // Only on this phone: nothing to delete on the server, so the upload is cancelled.
        await cancelUpload(queue, pendingFiles, photoId);
        await discardFailed(asyncStorageStore, ownerId, photoId, pendingFiles);
        await readLocal();
        return { ok: true };
      }
      // The delete is queued first, so a storage error while tidying up can't lose both. Refused
      // changes of this photo are moot once it is deleted.
      await record(photoDeleteChange({ projectId, taskId, id: photoId }));
      await discardFailed(asyncStorageStore, ownerId, photoId, pendingFiles);
      return { ok: true };
    },
    [photos, ready, ownerId, involved, queue, readLocal, record, projectId, taskId],
  );

  const setCaption = useCallback<TaskPhotos["setCaption"]>(
    async (photoId, text) => {
      const photo = photos.find((p) => p.id === photoId);
      if (!ready || !photo) return { ok: false, reason: "not_ready" };
      if (!canCaption(involved, photo)) return { ok: false, reason: "not_allowed" };
      const check = captionCheck(text);
      if (!check.canSave) return { ok: false, reason: "too_long" };
      if (check.value !== photo.caption) await record(photoCaptionChange({ projectId, taskId, id: photoId, caption: check.value, now: new Date() }));
      return { ok: true };
    },
    [photos, ready, involved, record, projectId, taskId],
  );

  const retry = useCallback(
    async (photoId: string) => {
      if (ownerId === null) return;
      await retryFailed(queue, asyncStorageStore, ownerId, photoId);
      await readLocal();
      await afterEnqueue();
    },
    [ownerId, queue, readLocal, afterEnqueue],
  );

  const discard = useCallback(
    async (photoId: string) => {
      if (ownerId === null) return;
      await discardFailed(asyncStorageStore, ownerId, photoId, pendingFiles);
      await readLocal();
    },
    [ownerId, readLocal],
  );

  return {
    photos,
    count: photoCount(photos),
    freePlaces: freePlaces(photos),
    grid: gridOf(photos),
    loading: !fetched && server === null,
    unavailable,
    offline: fetched && fetchFailed && !unavailable && server === null && photos.length === 0,
    involved,
    addState: unavailable ? "hidden" : addState(involved, photos),
    showSection: showSection(involved, photos),
    add,
    remove,
    setCaption,
    retry,
    discard,
    canRemove: (photo) => canRemove(involved, photo),
    canCaption: (photo) => canCaption(involved, photo),
  };
}
