import { COMMENT_ENTITY, PHOTO_ENTITY, PHOTO_UPLOAD_ENTITY } from "./entities";
import { createComment, deleteComment, listComments, patchComment } from "./comments/api";
import { deletePhoto, listPhotos, patchPhotoCaption, recordPhoto, signPhoto } from "./photos/api";
import { isInvolved } from "./permissions";
import type { Task } from "./types";

/** The server calls that read and change a parent's comments. Same shapes for every parent kind. */
export type CommentsApi = {
  listComments: typeof listComments;
  createComment: typeof createComment;
  patchComment: typeof patchComment;
  deleteComment: typeof deleteComment;
};

/** The server calls that read and change a parent's photos. Same shapes for every parent kind. */
export type PhotosApi = {
  listPhotos: typeof listPhotos;
  signPhoto: typeof signPhoto;
  recordPhoto: typeof recordPhoto;
  patchPhotoCaption: typeof patchPhotoCaption;
  deletePhoto: typeof deletePhoto;
};

/** Where a parent kind keeps its comments: the server calls, the saved cache and the queue entity of its changes. */
export type CommentsScope = { api: CommentsApi; cacheKey: string; entity: string };

/** Where a parent kind keeps its photos: the server calls, the saved cache and the queue entities of its changes. */
export type PhotosScope = { api: PhotosApi; cacheKey: string; uploadEntity: string; entity: string };

/** What the comments and photos code needs to know about the thing they belong to (a task, an idea, a drink draft). */
export type Parent = {
  kind: "task" | "idea" | "draft";
  projectId: string;
  /** The task or idea id. Queued changes and caches call it `taskId` whatever the kind: it is the parent id. */
  id: string;
  comments: CommentsScope;
  photos: PhotosScope;
  /**
   * Whether the viewer may set the reminder flag on comments. Absent when the parent has no such flag (no bell
   * and no "Nhắc kèm" at all); false when it has one but the viewer may only look at it.
   */
  canFlag?: boolean;
  /** Whether the viewer may add photos, and caption and delete them unless `canManagePhoto` narrows that per photo. */
  canManagePhotos: boolean;
  /**
   * Per-photo narrowing of caption and delete, for parents where that depends on who added the photo (a draft:
   * the adder or an Owner). Absent: `canManagePhotos` decides for every photo. It never widens `canManagePhotos`.
   */
  canManagePhoto?: (photo: { addedBy: { id: string } | null }) => boolean;
};

export const TASK_COMMENTS: CommentsScope = {
  api: { listComments, createComment, patchComment, deleteComment },
  cacheKey: "comments.cache.v1",
  entity: COMMENT_ENTITY,
};

export const TASK_PHOTOS: PhotosScope = {
  api: { listPhotos, signPhoto, recordPhoto, patchPhotoCaption, deletePhoto },
  cacheKey: "photos.cache.v1",
  uploadEntity: PHOTO_UPLOAD_ENTITY,
  entity: PHOTO_ENTITY,
};

/** The adapter of a task: its creator and assignees flag comments and manage photos. An unknown task or person gets neither. */
export function taskParent(
  projectId: string,
  taskId: string,
  task: Pick<Task, "createdById" | "assignees"> | null,
  myId: string | null,
): Parent {
  const involved = task !== null && isInvolved(task, myId);
  return { kind: "task", projectId, id: taskId, comments: TASK_COMMENTS, photos: TASK_PHOTOS, canFlag: involved, canManagePhotos: involved };
}
