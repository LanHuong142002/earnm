/** The longer side of an uploaded photo (spec R3). */
export const MAX_SIDE = 1600;
/** JPEG quality of an uploaded photo: a typical photo ends well under 1 MB. */
export const JPEG_QUALITY = 0.7;

export type Resize = { width: number } | { height: number };

/**
 * The resize that brings the longer side down to 1600 px, or null when it already fits (a photo is never
 * enlarged) or its size is not known.
 */
export function resizeFor(width: number, height: number): Resize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (Math.max(width, height) <= MAX_SIDE) return null;
  return height > width ? { height: MAX_SIDE } : { width: MAX_SIDE };
}

export type PickedPhoto = { uri: string; width: number; height: number };
export type PreparedPhoto = { id: string; width: number; height: number };

export type PrepareDeps = {
  /** Re-encodes as JPEG at `quality`, resized when `resize` is given. Resolves to the new (temporary) file. */
  manipulate: (uri: string, resize: Resize | null, quality: number) => Promise<{ uri: string; width: number; height: number }>;
  /** Moves the file to `documentDirectory/pending-photos/<id>.jpg`, where it waits to upload and survives a restart. */
  store: (id: string, fromUri: string) => Promise<void>;
};

/** The server accepts whole numbers from 1 to 20000. */
const whole = (n: number) => Math.max(1, Math.round(n));

/** Shrinks a picked photo, saves it as JPEG under the photo's id and reports its final size. */
export async function preparePhoto(source: PickedPhoto, id: string, deps: PrepareDeps): Promise<PreparedPhoto> {
  let out = await deps.manipulate(source.uri, resizeFor(source.width, source.height), JPEG_QUALITY);
  // The picker may not report a size; the result's own size is then the truth.
  const again = resizeFor(whole(out.width), whole(out.height));
  if (again) out = await deps.manipulate(out.uri, again, JPEG_QUALITY);
  await deps.store(id, out.uri);
  return { id, width: whole(out.width), height: whole(out.height) };
}
