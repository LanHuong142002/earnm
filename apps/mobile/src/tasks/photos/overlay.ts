import type { Change } from "../../sync/queue";
import { PHOTO_ENTITY, PHOTO_UPLOAD_ENTITY } from "../entities";
import type { Photo, PhotoEditState, PhotoState, ServerPhoto } from "./types";

const forTask = (taskId: string, change: Change) =>
  (change.entity === PHOTO_ENTITY || change.entity === PHOTO_UPLOAD_ENTITY) && change.data.taskId === taskId;

type Options = {
  /** Ids of uploads being sent right now. */
  uploading: ReadonlySet<string>;
  /** Where the prepared file of a photo that is not uploaded yet lives. */
  localUri: (photoId: string) => string;
};

const EDIT_RANK: Record<PhotoEditState, number> = { none: 0, waiting: 1, failed: 2 };
const strongerEdit = (a: PhotoEditState, b: PhotoEditState): PhotoEditState => (EDIT_RANK[a] >= EDIT_RANK[b] ? a : b);

function apply(list: Photo[], change: Change, failed: boolean, opts: Options): Photo[] {
  const { data } = change;
  const index = list.findIndex((p) => p.id === change.entityId);
  const edit: PhotoEditState = failed ? "failed" : "waiting";

  if (change.entity === PHOTO_UPLOAD_ENTITY) {
    const state: PhotoState = failed ? "failed" : opts.uploading.has(change.entityId) ? "uploading" : "waiting";
    if (index !== -1) return list; // the server already has it, or a refused attempt is already shown
    const authorId = typeof data.authorId === "string" ? data.authorId : null;
    const uri = opts.localUri(change.entityId);
    const added: Photo = {
      id: change.entityId,
      taskId: String(data.taskId),
      addedBy: authorId === null ? null : { id: authorId, displayName: typeof data.authorName === "string" ? data.authorName : "" },
      caption: typeof data.caption === "string" ? data.caption : "",
      width: typeof data.width === "number" ? data.width : 0,
      height: typeof data.height === "number" ? data.height : 0,
      createdAt: change.createdAt,
      thumbUrl: uri,
      url: uri,
      state,
      edit: "none",
    };
    return [...list, added];
  }

  if (index === -1) return list;
  if (change.kind === "delete") {
    // A waiting delete hides the photo; a refused one leaves it on screen, marked.
    if (!failed) return list.filter((p) => p.id !== change.entityId);
    return list.map((p, i) => (i === index ? { ...p, edit: strongerEdit(p.edit, edit) } : p));
  }
  if (change.kind === "update") {
    return list.map((p, i) => {
      if (i !== index) return p;
      const next: Photo = { ...p, edit: strongerEdit(p.edit, edit) };
      if (typeof data.caption === "string") next.caption = data.caption;
      return next;
    });
  }
  return list;
}

/**
 * The photos of one task as the screen shows them: the server's list with the refused changes and then the
 * waiting ones laid over it. A queued upload is a photo on the phone (waiting, uploading, or failed once
 * refused), a waiting caption change shows its new text, a waiting delete hides the photo, and a refused
 * change leaves the photo on screen marked failed. Changes for a photo that is not there are ignored.
 */
export function applyPhotoOverlay(taskId: string, serverList: ServerPhoto[], waiting: Change[], failed: Change[], opts: Options): Photo[] {
  let list: Photo[] = serverList.map((p) => ({ ...p, state: "synced" as const, edit: "none" as const }));
  for (const change of failed) if (forTask(taskId, change)) list = apply(list, change, true, opts);
  for (const change of waiting) if (forTask(taskId, change)) list = apply(list, change, false, opts);
  return list;
}

/**
 * Refused caption changes and deletes whose photo is gone from the server's list (deleted elsewhere): nothing
 * can retry them, so they should be dropped. A refused upload, and a change to a photo whose upload was
 * refused, are never stale.
 */
export function staleFailedIds(taskId: string, serverList: ServerPhoto[], failed: Change[]): string[] {
  const known = new Set(serverList.map((p) => p.id));
  for (const change of failed) if (forTask(taskId, change) && change.entity === PHOTO_UPLOAD_ENTITY) known.add(change.entityId);
  return failed.filter((c) => forTask(taskId, c) && c.entity === PHOTO_ENTITY && !known.has(c.entityId)).map((c) => c.changeId);
}
