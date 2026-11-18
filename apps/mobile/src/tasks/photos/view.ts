import { isInvolved } from "../permissions";
import type { Photo } from "./types";

export { isInvolved };

/** A task holds at most 10 photos, counting the ones still waiting to upload (spec R2). */
export const PHOTO_MAX = 10;
/** The grid shows at most 8 thumbnails; with more, the 8th carries "+N" (spec R21). */
export const GRID_MAX = 8;
/** The longest caption, after trimming (spec R6). */
export const CAPTION_MAX = 200;

/**
 * How many places the photos take: every one the server has plus every one waiting or uploading. A refused
 * upload holds no place; it is counted again if the person retries it and the task still has room.
 */
export const photoCount = (photos: Photo[]): number => photos.filter((p) => p.state !== "failed").length;

export const freePlaces = (photos: Photo[]): number => Math.max(0, PHOTO_MAX - photoCount(photos));

function byTime(a: Photo, b: Photo): number {
  const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A copy, oldest first. */
export const sortPhotos = (photos: Photo[]): Photo[] => [...photos].sort(byTime);

/** "＋ Thêm": not offered to people who are not involved, disabled with the explaining line at 10 (spec R2, R7, R23). */
export type AddState = "hidden" | "open" | "full";

export function addState(involved: boolean, photos: Photo[]): AddState {
  if (!involved) return "hidden";
  return freePlaces(photos) > 0 ? "open" : "full";
}

/**
 * Cuts what the person picked to the places left. `take` photos are prepared and queued; `dropped` were left
 * out, and the screen should say so.
 */
export function acceptPicks(picked: number, free: number): { take: number; dropped: number } {
  const take = Math.max(0, Math.min(picked, free));
  return { take, dropped: Math.max(0, picked - take) };
}

/** The section shows for involved people, and for other members only when there is something to see (spec R24). */
export const showSection = (involved: boolean, photos: Photo[]): boolean => involved || photos.length > 0;

export type Grid = {
  /** At most 8 photos, in the order given. */
  tiles: Photo[];
  /** The N of "+N" on the last tile; 0 when every photo has its own tile. */
  overflow: number;
};

/** With more than 8 photos the 8th tile shows "+N", where N counts it and every photo after it. */
export function gridOf(photos: Photo[]): Grid {
  const tiles = photos.slice(0, GRID_MAX);
  const overflow = photos.length > GRID_MAX ? photos.length - (GRID_MAX - 1) : 0;
  return { tiles, overflow };
}

/**
 * Whether a photo can be removed: an uploaded one by deleting it, one that waits or failed by dropping it.
 * One being sent right now cannot be taken back.
 */
export const canRemove = (involved: boolean, photo: Photo): boolean => involved && photo.state !== "uploading";

/**
 * Captions change on photos the server has; a photo still on the phone has no caption sheet yet. A photo whose
 * last change was refused first offers retry or discard.
 */
export const canCaption = (involved: boolean, photo: Photo): boolean => involved && photo.state === "synced" && photo.edit !== "failed";

export type CaptionCheck = {
  /** Characters after trimming. */
  length: number;
  /** How many characters to remove to fit; 0 when it fits. */
  over: number;
  /** The trimmed text to save; empty clears the caption. */
  value: string;
  canSave: boolean;
};

/** Spec R6: 0 to 200 characters after trimming. */
export function captionCheck(text: string): CaptionCheck {
  const value = text.trim();
  const over = Math.max(0, value.length - CAPTION_MAX);
  return { length: value.length, over, value, canSave: over === 0 };
}
