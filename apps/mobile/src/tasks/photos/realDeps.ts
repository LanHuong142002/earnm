import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { deletePhoto, patchPhotoCaption, recordPhoto, signPhoto } from "./api";
import type { PrepareDeps } from "./prepare";
import type { PendingFiles, PhotoDeps } from "./uploads";

// The phone-only parts of the photo code (files and image encoding). Kept apart so the logic can be tested without native modules.

const pendingDir = () => new Directory(Paths.document, "pending-photos");
const pendingFile = (id: string) => new File(pendingDir(), `${id}.jpg`);

export const pendingFiles: PendingFiles = {
  uriFor: (id) => pendingFile(id).uri,
  exists: (id) => {
    try {
      return pendingFile(id).exists;
    } catch {
      return false;
    }
  },
  remove: (id) => {
    try {
      const file = pendingFile(id);
      if (file.exists) file.delete();
    } catch {
      // A file that cannot be removed is left; it holds nothing the queue still points to.
    }
  },
};

/** Removes every waiting photo file (on sign-out, so one person's pictures never reach the next). */
export function clearPendingFiles(): void {
  try {
    const dir = pendingDir();
    if (dir.exists) dir.delete();
  } catch {
    // Best effort: the queue is cleared anyway, so nothing points at these files.
  }
}

export const prepareDeps: PrepareDeps = {
  manipulate: async (uri, resize, quality) => {
    const context = ImageManipulator.manipulate(uri);
    if (resize) context.resize(resize);
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  },
  store: async (id, fromUri) => {
    pendingDir().create({ intermediates: true, idempotent: true });
    const target = pendingFile(id);
    if (target.exists) target.delete();
    new File(fromUri).move(target);
  },
};

export const photoDeps: PhotoDeps = {
  signPhoto,
  recordPhoto,
  patchPhotoCaption,
  deletePhoto,
  fetch: (input, init) => fetch(input, init),
  files: pendingFiles,
};
