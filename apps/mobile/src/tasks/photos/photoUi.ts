import type { Photo } from "./types";
import type { AddResult } from "./useTaskPhotos";
import { CAPTION_MAX } from "./view";

export type PickSource = "camera" | "library";

/**
 * What to ask `expo-image-picker` for. The library takes several photos at once, up to the free places; the
 * camera takes one. Photos are re-encoded by `preparePhoto`, so the picker does no editing.
 */
export function pickerOptions(source: PickSource, freePlaces: number) {
  const multiple = source === "library";
  return {
    mediaTypes: ["images" as const],
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? Math.max(1, freePlaces) : undefined,
    quality: 1,
  };
}

/** The message key for a refused permission (spec R25). */
export const pickerProblem = (source: PickSource) => (source === "camera" ? "tasks.photos.cameraDenied" : "tasks.photos.libraryDenied");

export type Notice = { key: string; count?: number };

/** The short message to show after `add` (null when everything went in). */
export function addNotice(result: AddResult): Notice | null {
  if (!result.ok) {
    if (result.reason === "full") return { key: "tasks.photos.fullLine" };
    if (result.reason === "not_allowed") return { key: "tasks.photos.notAllowed" };
    return { key: "tasks.photos.notReady" };
  }
  if (result.dropped > 0) return { key: "tasks.photos.droppedNotice", count: result.dropped };
  if (result.failed > 0) return { key: "tasks.photos.failedNotice", count: result.failed };
  return null;
}

export type Overlay = "none" | "uploading" | "waiting" | "failed";

/** What a thumbnail shows over the picture. A refused caption change or delete asks for a retry like a failed upload. */
export function overlayOf(photo: Pick<Photo, "state" | "edit">): Overlay {
  if (photo.state === "failed" || photo.edit === "failed") return "failed";
  if (photo.state === "uploading") return "uploading";
  if (photo.state === "waiting") return "waiting";
  return "none";
}

/** The accessible name of a thumbnail: its state wins over the caption, so it is never colour alone. */
export function thumbLabelKey(photo: Pick<Photo, "state" | "edit" | "caption">): string {
  const overlay = overlayOf(photo);
  if (overlay === "failed") return "tasks.photos.thumbFailedA11y";
  if (overlay === "waiting") return "tasks.photos.thumbWaitingA11y";
  if (overlay === "uploading") return "tasks.photos.thumbUploadingA11y";
  return photo.caption ? "tasks.photos.thumbCaptionA11y" : "tasks.photos.thumbA11y";
}

/** The viewer opens at the tapped photo, or the first. */
export function viewerStart(photos: Pick<Photo, "id">[], photoId: string | undefined): number {
  const at = photos.findIndex((p) => p.id === photoId);
  return at < 0 ? 0 : at;
}

/** After deleting the photo at `index` of `total`: the position to show next, or null to close the viewer. */
export function afterDelete(index: number, total: number): number | null {
  const left = total - 1;
  if (left <= 0) return null;
  return Math.min(index, left - 1);
}

/** The caption's character counter: shown only with fewer than 20 left (mockup 3c). */
export function captionCounter(length: number): { remaining: number; over: boolean } | null {
  const remaining = CAPTION_MAX - length;
  if (remaining >= 20) return null;
  return { remaining, over: remaining < 0 };
}
