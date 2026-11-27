import { request } from "../lib/api";
import { withDraftDefaults } from "../drafts/defaults";
import type { CreateDraftBody } from "../drafts/api";
import type { Draft } from "../drafts/types";
import type { ServerComment } from "../tasks/comments/types";
import type { CommentsApi, PhotosApi } from "../tasks/parent";
import type { Task } from "../tasks/types";
import type { ServerPhoto, UploadSignature } from "../tasks/photos/types";
import { withVoteCounts } from "./voteCounts";
import type { Idea, IdeaStatus, Vote } from "./types";

type Stamped<T> = { value: T; editedAt: string };

export type CreateIdeaBody = { id: string; title: string; description?: string; labelIds?: string[] };

/** Each field has its own time; the body is the fields themselves (not wrapped). `labels` is the whole set of label ids. */
export type IdeaFieldPatch = {
  title?: Stamped<string>;
  description?: Stamped<string>;
  status?: Stamped<IdeaStatus>;
  labels?: Stamped<string[]>;
};

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/ideas`;
const one = (projectId: string, ideaId: string) => `${base(projectId)}/${encodeURIComponent(ideaId)}`;

export const listIdeas = (token: string, projectId: string) =>
  request<{ ideas: Idea[] }>(base(projectId), { token }).then((r) => r.ideas.map(withVoteCounts));

export const createIdea = (token: string, projectId: string, body: CreateIdeaBody) =>
  request<Idea>(base(projectId), { method: "POST", body, token }).then(withVoteCounts);

export const patchIdea = (token: string, projectId: string, ideaId: string, fields: IdeaFieldPatch) =>
  request<Idea>(one(projectId, ideaId), { method: "PATCH", body: fields, token }).then(withVoteCounts);

export const deleteIdea = (token: string, projectId: string, ideaId: string) =>
  request<void>(one(projectId, ideaId), { method: "DELETE", token });

/** Makes the task of an accepted idea, once, and links both ways (spec R13). Needs the network: nothing is queued. */
export const createTaskFromIdea = (
  token: string,
  projectId: string,
  ideaId: string,
  taskId: string,
  fields: {
    title: string;
    description: string;
    assigneeIds: string[];
    dueDate: string | null;
    dueTime: string | null;
  },
) =>
  request<{ task: Task; idea: Idea }>(`${one(projectId, ideaId)}/task`, {
    method: "POST",
    body: { taskId, ...fields },
    token,
  }).then((r) => ({ ...r, idea: withVoteCounts(r.idea) }));

/**
 * Makes the drink draft of an accepted idea, once, and links both ways (spec R6). Needs the network: nothing is
 * queued. `photosNotCopied` counts idea photos that could not be copied onto the draft.
 */
export const createDraftFromIdea = (token: string, projectId: string, ideaId: string, body: CreateDraftBody) =>
  request<{ draft: Draft; idea: Idea; photosNotCopied: number }>(`${one(projectId, ideaId)}/draft`, {
    method: "POST",
    body: { draftId: body.id, name: body.name, sizes: body.sizes, expectedPrice: body.expectedPrice, note: body.note },
    token,
  }).then((r) => ({ ...r, draft: withDraftDefaults(r.draft), idea: withVoteCounts(r.idea) }));

/** Sets the caller's vote; 0 takes it back. */
export const putVote = (token: string, projectId: string, ideaId: string, value: Vote) =>
  request<Idea>(`${one(projectId, ideaId)}/vote`, { method: "PUT", body: { value }, token }).then(withVoteCounts);

// Comments and photos of an idea use the task's components, which know their parent as `taskId` and a comment
// as having a reminder flag. The API says `ideaId` and has no flag, so each answer is mapped on the way in.

type ApiComment = Omit<ServerComment, "taskId" | "remindWith"> & { ideaId: string };
const toComment = ({ ideaId, ...rest }: ApiComment): ServerComment => ({ ...rest, taskId: ideaId, remindWith: false });

const commentsBase = (projectId: string, ideaId: string) => `${one(projectId, ideaId)}/comments`;

export const ideaCommentsApi: CommentsApi = {
  listComments: (token, projectId, ideaId) =>
    request<{ comments: ApiComment[] }>(commentsBase(projectId, ideaId), { token }).then((r) => r.comments.map(toComment)),
  createComment: (token, projectId, ideaId, body) =>
    request<ApiComment>(commentsBase(projectId, ideaId), { method: "POST", body: { id: body.id, text: body.text }, token }).then(toComment),
  patchComment: (token, projectId, ideaId, commentId, fields) =>
    request<ApiComment>(`${commentsBase(projectId, ideaId)}/${encodeURIComponent(commentId)}`, {
      method: "PATCH",
      body: fields.text ? { text: fields.text } : {},
      token,
    }).then(toComment),
  deleteComment: (token, projectId, ideaId, commentId) =>
    request<void>(`${commentsBase(projectId, ideaId)}/${encodeURIComponent(commentId)}`, { method: "DELETE", token }),
};

type ApiPhoto = Omit<ServerPhoto, "taskId"> & { ideaId: string };
const toPhoto = ({ ideaId, ...rest }: ApiPhoto): ServerPhoto => ({ ...rest, taskId: ideaId });

const photosBase = (projectId: string, ideaId: string) => `${one(projectId, ideaId)}/photos`;

export const ideaPhotosApi: PhotosApi = {
  listPhotos: (token, projectId, ideaId) =>
    request<{ photos: ApiPhoto[] }>(photosBase(projectId, ideaId), { token }).then((r) => r.photos.map(toPhoto)),
  signPhoto: (token, projectId, ideaId, id) =>
    request<UploadSignature>(`${photosBase(projectId, ideaId)}/sign`, { method: "POST", body: { id }, token }),
  recordPhoto: (token, projectId, ideaId, body) =>
    request<ApiPhoto>(photosBase(projectId, ideaId), { method: "POST", body, token }).then(toPhoto),
  patchPhotoCaption: (token, projectId, ideaId, photoId, caption) =>
    request<ApiPhoto>(`${photosBase(projectId, ideaId)}/${encodeURIComponent(photoId)}`, { method: "PATCH", body: { caption }, token }).then(toPhoto),
  deletePhoto: (token, projectId, ideaId, photoId) =>
    request<void>(`${photosBase(projectId, ideaId)}/${encodeURIComponent(photoId)}`, { method: "DELETE", token }),
};
