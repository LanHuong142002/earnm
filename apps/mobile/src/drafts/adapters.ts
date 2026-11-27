import type { ProjectRole } from "../tasks/types";
import type { CommentsApi, CommentsScope, Parent, PhotosScope } from "../tasks/parent";
import { draftPhotosApi } from "./api";
import { DRAFT_PHOTO_ENTITY, DRAFT_PHOTO_UPLOAD_ENTITY } from "./entities";
import type { Draft } from "./types";

/** Where draft photos are kept: their own server calls, saved cache and queue entities. */
export const DRAFT_PHOTOS: PhotosScope = {
  api: draftPhotosApi,
  cacheKey: "draftPhotos.cache.v1",
  uploadEntity: DRAFT_PHOTO_UPLOAD_ENTITY,
  entity: DRAFT_PHOTO_ENTITY,
};

const noComments = () => Promise.reject(new Error("Drafts have no comments"));
const NO_COMMENTS_API: CommentsApi = { listComments: noComments, createComment: noComments, patchComment: noComments, deleteComment: noComments };

/** A draft has no comments. `Parent` needs a scope, so this one has its own cache key and refuses every call. */
export const DRAFT_COMMENTS: CommentsScope = { api: NO_COMMENTS_API, cacheKey: "draftComments.cache.v1", entity: "draftComment" };

/**
 * The adapter of a draft for the photos components (spec R11-R13). Any member adds photos until the draft is
 * converted; after that nobody does. Caption and delete are per photo: only the person who added it, or a
 * project Owner (`canManagePhoto`). The server enforces the same, so this only hides what would be refused.
 */
export function draftParent(
  projectId: string,
  draftId: string,
  draft: Pick<Draft, "convertedAt"> | null,
  myId: string | null,
  myRole: ProjectRole | null,
): Parent {
  const open = draft !== null && draft.convertedAt === null && myId !== null && myRole !== null;
  return {
    kind: "draft",
    projectId,
    id: draftId,
    comments: DRAFT_COMMENTS,
    photos: DRAFT_PHOTOS,
    canManagePhotos: open,
    canManagePhoto: (photo) => open && (myRole === "owner" || (photo.addedBy !== null && photo.addedBy.id === myId)),
  };
}
