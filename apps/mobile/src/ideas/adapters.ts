import type { ProjectRole } from "../tasks/types";
import type { CommentsScope, Parent, PhotosScope } from "../tasks/parent";
import { ideaCommentsApi, ideaPhotosApi } from "./api";
import { IDEA_COMMENT_ENTITY, IDEA_PHOTO_ENTITY, IDEA_PHOTO_UPLOAD_ENTITY } from "./entities";
import { canEditIdea } from "./permissions";
import type { Idea } from "./types";

/** Where idea comments are kept: their own server calls, saved cache and queue entity. */
export const IDEA_COMMENTS: CommentsScope = {
  api: ideaCommentsApi,
  cacheKey: "ideaComments.cache.v1",
  entity: IDEA_COMMENT_ENTITY,
};

/** Where idea photos are kept: their own server calls, saved cache and queue entities. */
export const IDEA_PHOTOS: PhotosScope = {
  api: ideaPhotosApi,
  cacheKey: "ideaPhotos.cache.v1",
  uploadEntity: IDEA_PHOTO_UPLOAD_ENTITY,
  entity: IDEA_PHOTO_ENTITY,
};

/**
 * The adapter of an idea for the comments and photos components. An idea has no reminder flag (`canFlag` is
 * absent: no bell, no "Nhắc kèm"); photos are managed by the author and the project's Owners (spec R11). While
 * the idea or the person is not known nobody manages photos.
 */
export function ideaParent(
  projectId: string,
  ideaId: string,
  idea: Pick<Idea, "author"> | null,
  myId: string | null,
  myRole: ProjectRole | null,
): Parent {
  const canManagePhotos = idea !== null && myId !== null && myRole !== null && canEditIdea(idea, myId, myRole);
  return { kind: "idea", projectId, id: ideaId, comments: IDEA_COMMENTS, photos: IDEA_PHOTOS, canManagePhotos };
}
