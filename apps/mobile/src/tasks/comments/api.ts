import { request } from "../../lib/api";
import type { ServerComment } from "./types";

type Stamped<T> = { value: T; editedAt: string };

/** Each field has its own time, so a text edit and a flag change merge separately on the server. */
export type CommentFieldPatch = { text?: Stamped<string>; remindWith?: Stamped<boolean> };

const base = (projectId: string, taskId: string) =>
  `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`;

export const listComments = (token: string, projectId: string, taskId: string) =>
  request<{ comments: ServerComment[] }>(base(projectId, taskId), { token }).then((r) => r.comments);

export const createComment = (
  token: string,
  projectId: string,
  taskId: string,
  body: { id: string; text: string; remindWith?: boolean },
) => request<ServerComment>(base(projectId, taskId), { method: "POST", body, token });

export const patchComment = (token: string, projectId: string, taskId: string, commentId: string, fields: CommentFieldPatch) =>
  request<ServerComment>(`${base(projectId, taskId)}/${encodeURIComponent(commentId)}`, { method: "PATCH", body: fields, token });

export const deleteComment = (token: string, projectId: string, taskId: string, commentId: string) =>
  request<void>(`${base(projectId, taskId)}/${encodeURIComponent(commentId)}`, { method: "DELETE", token });
