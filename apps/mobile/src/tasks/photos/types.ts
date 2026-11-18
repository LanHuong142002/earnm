/** A photo exactly as the API returns it. `thumbUrl` and `url` are signed Cloudinary delivery URLs. */
export type ServerPhoto = {
  id: string;
  taskId: string;
  /** Null once the person's account is gone. */
  addedBy: { id: string; displayName: string } | null;
  caption: string;
  width: number;
  height: number;
  createdAt: string;
  thumbUrl: string;
  url: string;
};

/** Where a photo is in its upload: `synced` is recorded on the server; the others only exist on this phone. */
export type PhotoState = "waiting" | "uploading" | "failed" | "synced";

/** Whether a caption change or delete of a photo the server has is queued or was refused for good. */
export type PhotoEditState = "none" | "waiting" | "failed";

/**
 * A photo as the screen shows it. Until it is uploaded, `thumbUrl` and `url` are the file on this phone.
 * `state` is about the upload; `edit` is about a queued caption change or delete.
 */
export type Photo = ServerPhoto & { state: PhotoState; edit: PhotoEditState };

/**
 * What a queued photo change's `data` holds. Every change carries `projectId` and `taskId`.
 * - photoUpload create: `width`, `height` of the prepared file, `caption` (optional), and `authorId` /
 *   `authorName` (to show it before the server answers; never sent). The file is found by the photo id.
 * - photo update: `caption` only.
 * - photo delete: nothing more.
 */
export type PhotoChangeData = {
  projectId: string;
  taskId: string;
  width?: number;
  height?: number;
  caption?: string;
  authorId?: string;
  authorName?: string;
};

/** What `POST /sign` returns: the only thing the phone ever uses to upload. */
export type UploadSignature = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  publicId: string;
  type: "authenticated";
};
