import { ApiError } from "../../lib/api";
import type { Change, NewChange, Queue } from "../../sync/queue";
import type { KeyValueStore } from "../../sync/storage";
import { PHOTO_ENTITY, PHOTO_UPLOAD_ENTITY } from "../entities";
import { deletePhoto, patchPhotoCaption, recordPhoto, signPhoto } from "./api";
import { notifyPhotos, recordFailed, updatePhotoCache, withoutFailed } from "./store";
import type { UploadSignature } from "./types";

/** The files of photos that wait to upload. They live in the app's document folder, so a restart keeps them. */
export type PendingFiles = {
  /** Where the prepared file of photo `id` is. Always computed, never saved: the document folder's path can change. */
  uriFor: (id: string) => string;
  exists: (id: string) => boolean;
  remove: (id: string) => void;
};

export type PhotoDeps = {
  signPhoto: typeof signPhoto;
  recordPhoto: typeof recordPhoto;
  patchPhotoCaption: typeof patchPhotoCaption;
  deletePhoto: typeof deletePhoto;
  fetch: typeof fetch;
  files: PendingFiles;
};

/** Cloudinary accepts at most this size, and so does the server (whole numbers from 1 to 20000). */
const SIZE_MAX = 20000;
const isSize = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= SIZE_MAX;

const timeOf = (change: Change, field: string) => change.fieldTimes[field] ?? change.createdAt;

// Uploads being sent right now: the one state the queue does not keep.
const uploading = new Set<string>();

/** Ids of the photos being uploaded at this moment. */
export const uploadingIds = (): ReadonlySet<string> => new Set(uploading);

// Refusals are saved a moment after the queue reports them; readers wait for these before they look.
const pendingFailures = new Set<Promise<unknown>>();

/** Resolves once every refusal reported so far has been saved as failed. */
export async function settleFailures(): Promise<void> {
  while (pendingFailures.size > 0) await Promise.all([...pendingFailures]);
}

type Where = { projectId: string; taskId: string };

/**
 * A photo waiting to upload. The queue entry holds only ids, the size and who added it (to show it before the
 * server answers); the file itself is found again by the photo id.
 */
export function photoUploadChange(input: Where & {
  id: string;
  width: number;
  height: number;
  caption?: string;
  author: { id: string; displayName: string } | null;
  now: Date;
}): NewChange {
  const data: Record<string, unknown> = { projectId: input.projectId, taskId: input.taskId, width: input.width, height: input.height };
  if (input.caption !== undefined) data.caption = input.caption;
  if (input.author) {
    data.authorId = input.author.id;
    data.authorName = input.author.displayName;
  }
  const at = input.now.toISOString();
  return { entity: PHOTO_UPLOAD_ENTITY, entityId: input.id, kind: "create", data, fieldTimes: input.caption !== undefined ? { caption: at } : {} };
}

export function photoCaptionChange(input: Where & { id: string; caption: string; now: Date }): NewChange {
  return {
    entity: PHOTO_ENTITY,
    entityId: input.id,
    kind: "update",
    data: { projectId: input.projectId, taskId: input.taskId, caption: input.caption },
    fieldTimes: { caption: input.now.toISOString() },
  };
}

export function photoDeleteChange(input: Where & { id: string }): NewChange {
  return { entity: PHOTO_ENTITY, entityId: input.id, kind: "delete", data: { projectId: input.projectId, taskId: input.taskId }, fieldTimes: {} };
}

/** The answer of /sign is the only thing used to upload; anything else in it is ignored, and a gap is a server fault to try again. */
function checkedSignature(s: UploadSignature): UploadSignature {
  const ok =
    typeof s?.cloudName === "string" && s.cloudName !== "" &&
    typeof s.apiKey === "string" && s.apiKey !== "" &&
    typeof s.signature === "string" && s.signature !== "" &&
    typeof s.publicId === "string" && s.publicId !== "" &&
    typeof s.timestamp === "number" && s.type === "authenticated";
  if (!ok) throw new ApiError("bad_signature", 502);
  return s;
}

async function saysAlreadyExists(response: Response): Promise<boolean> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } } | null;
    const message = body?.error?.message;
    return typeof message === "string" && /already exists/i.test(message);
  } catch {
    return false;
  }
}

/**
 * Sends the prepared file to Cloudinary with exactly the fields the API signed. A refusal that no resend will
 * change (a 4xx other than 408 and 429) is permanent; a busy or failing Cloudinary, or no network, is tried again.
 */
async function uploadToCloudinary(sig: UploadSignature, uri: string, doFetch: typeof fetch): Promise<void> {
  const form = new FormData();
  form.append("file", { uri, name: "photo.jpg", type: "image/jpeg" } as unknown as Blob);
  form.append("api_key", sig.apiKey);
  form.append("timestamp", String(sig.timestamp));
  form.append("signature", sig.signature);
  form.append("public_id", sig.publicId);
  form.append("type", sig.type);
  // Signed too: an image that is already there can never be replaced.
  form.append("overwrite", "false");
  let response: Response;
  try {
    response = await doFetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(sig.cloudName)}/image/upload`, { method: "POST", body: form });
  } catch {
    throw new ApiError("network");
  }
  if (response.ok) return;
  // A retry after a lost answer meets the image it already uploaded: that is the outcome we wanted.
  if (response.status === 400 && (await saysAlreadyExists(response))) return;
  const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
  throw new ApiError(retryable ? "upload_unavailable" : "upload_refused", response.status);
}

/**
 * Registers photos with the shared queue: `photoUpload` (sign, upload, record) and `photo` (caption change, delete).
 * A permanent refusal is not the task-wide notice: the change is kept in the photo cache as failed, to retry or
 * discard. The queue only calls this for a refusal no resend will change; a network error, a 429 or a 503
 * (photos not set up yet) stays queued and is tried again.
 */
export function registerPhotoEntities(queue: Queue, store: KeyValueStore, deps: PhotoDeps): void {
  const rejected = (change: Change) => {
    const write = (async () => {
      const owner = await queue.ownerId();
      if (owner) await updatePhotoCache(store, owner, (cache) => recordFailed(cache, change));
    })()
      .catch(() => {})
      .finally(() => pendingFailures.delete(write));
    pendingFailures.add(write);
  };

  queue.registerEntity(
    PHOTO_UPLOAD_ENTITY,
    {
      create: async (change, token) => {
        const id = change.entityId;
        const projectId = String(change.data.projectId);
        const taskId = String(change.data.taskId);
        const { width, height } = change.data;
        if (!deps.files.exists(id)) throw new ApiError("local_file_missing", 400);
        if (!isSize(width) || !isSize(height)) throw new ApiError("invalid_photo_size", 400);
        uploading.add(id);
        notifyPhotos();
        try {
          const sig = checkedSignature(await deps.signPhoto(token, projectId, taskId, id));
          await uploadToCloudinary(sig, deps.files.uriFor(id), deps.fetch);
          const body: { id: string; publicId: string; width: number; height: number; caption?: string } = { id, publicId: sig.publicId, width, height };
          const caption = typeof change.data.caption === "string" ? change.data.caption.trim() : "";
          if (caption !== "") body.caption = caption;
          return await deps.recordPhoto(token, projectId, taskId, body);
        } finally {
          uploading.delete(id);
          notifyPhotos();
        }
      },
      // Nothing edits or deletes a photo that is not uploaded: those are cancelled (`cancelUpload`) instead.
      update: async () => {
        throw new ApiError("unsupported", 400);
      },
      delete: async () => {
        throw new ApiError("unsupported", 400);
      },
    },
    {
      // The picture is on the server now; the local copy is no longer needed.
      onApplied: (change) => {
        deps.files.remove(change.entityId);
      },
      onRejected: rejected,
    },
  );

  queue.registerEntity(
    PHOTO_ENTITY,
    {
      create: async () => {
        throw new ApiError("unsupported", 400);
      },
      update: (change, token) =>
        deps.patchPhotoCaption(token, String(change.data.projectId), String(change.data.taskId), change.entityId, {
          value: String(change.data.caption ?? ""),
          editedAt: timeOf(change, "caption"),
        }),
      delete: (change, token) => deps.deletePhoto(token, String(change.data.projectId), String(change.data.taskId), change.entityId),
    },
    { onApplied: () => {}, onRejected: rejected },
  );
}

/** Puts a photo's refused changes back on the queue, oldest first, and forgets them as failed. */
export async function retryFailed(queue: Queue, store: KeyValueStore, ownerId: string, photoId: string): Promise<void> {
  let taken: Change[] = [];
  await updatePhotoCache(store, ownerId, (cache) => {
    taken = cache.failed.filter((c) => c.entityId === photoId);
    return withoutFailed(cache, (c) => c.entityId === photoId);
  });
  for (const change of taken) {
    await queue.enqueue({ entity: change.entity, entityId: change.entityId, kind: change.kind, data: change.data, fieldTimes: change.fieldTimes });
  }
}

/** Drops a photo's refused changes for good, and the local file of an upload that was refused. */
export async function discardFailed(store: KeyValueStore, ownerId: string, photoId: string, files: PendingFiles): Promise<void> {
  let hadUpload = false;
  await updatePhotoCache(store, ownerId, (cache) => {
    hadUpload = cache.failed.some((c) => c.entityId === photoId && c.entity === PHOTO_UPLOAD_ENTITY);
    return withoutFailed(cache, (c) => c.entityId === photoId);
  });
  if (hadUpload) files.remove(photoId);
}

/** Takes a photo that waits to upload off the queue, with any caption change queued for it, and deletes its file. */
export async function cancelUpload(queue: Queue, files: PendingFiles, photoId: string): Promise<void> {
  await queue.dropEntity(PHOTO_UPLOAD_ENTITY, photoId);
  await queue.dropEntity(PHOTO_ENTITY, photoId);
  files.remove(photoId);
}
