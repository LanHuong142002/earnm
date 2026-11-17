import { request } from "../../lib/api";
import type { ServerPhoto, UploadSignature } from "./types";

const base = (projectId: string, taskId: string) =>
  `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/photos`;

export const listPhotos = (token: string, projectId: string, taskId: string) =>
  request<{ photos: ServerPhoto[] }>(base(projectId, taskId), { token }).then((r) => r.photos);

export const signPhoto = (token: string, projectId: string, taskId: string, id: string) =>
  request<UploadSignature>(`${base(projectId, taskId)}/sign`, { method: "POST", body: { id }, token });

export const recordPhoto = (
  token: string,
  projectId: string,
  taskId: string,
  body: { id: string; publicId: string; width: number; height: number; caption?: string },
) => request<ServerPhoto>(base(projectId, taskId), { method: "POST", body, token });

export const patchPhotoCaption = (token: string, projectId: string, taskId: string, photoId: string, caption: { value: string; editedAt: string }) =>
  request<ServerPhoto>(`${base(projectId, taskId)}/${encodeURIComponent(photoId)}`, { method: "PATCH", body: { caption }, token });

export const deletePhoto = (token: string, projectId: string, taskId: string, photoId: string) =>
  request<void>(`${base(projectId, taskId)}/${encodeURIComponent(photoId)}`, { method: "DELETE", token });
