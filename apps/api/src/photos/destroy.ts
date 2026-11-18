import type { PhotoStore } from "./cloudinary.js";

/**
 * Removes images from Cloudinary after the database change has committed. A failure is logged
 * (the public id and the error's kind only: never its message, which a library could fill with request details) and never thrown: the row is already
 * gone, so the image can no longer be reached through any link the API hands out.
 */
export async function destroyImages(
  store: PhotoStore | null | undefined,
  publicIds: string[],
): Promise<void> {
  if (!store) return;
  for (const publicId of publicIds) {
    try {
      await store.destroy(publicId);
    } catch (err) {
      console.error(
        `Could not remove image ${publicId} from Cloudinary: ${err instanceof Error ? err.name : "unknown error"}`,
      );
    }
  }
}
