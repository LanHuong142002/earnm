import type { Currency } from "../lib/currency";
import { request } from "../lib/api";

export type ProjectRole = "owner" | "member";

export type Project = {
  id: string;
  name: string;
  description: string;
  currency: Currency;
  role: ProjectRole;
};

export type CreateProjectBody = {
  id: string;
  name: string;
  currency: Currency;
  description?: string;
  editedAt: string;
};

export type ProjectField = "name" | "description" | "currency";
export type ProjectFieldPatch = Partial<Record<ProjectField, { value: unknown; editedAt: string }>>;

export const listProjects = (token: string) => request<Project[]>("/projects", { token });

export const createProject = (token: string, body: CreateProjectBody) =>
  request<Project>("/projects", { method: "POST", body, token });

export const patchProject = (token: string, id: string, fields: ProjectFieldPatch) =>
  request<Project>(`/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { fields },
    token,
  });

export const deleteProject = (token: string, id: string) =>
  request<void>(`/projects/${encodeURIComponent(id)}`, { method: "DELETE", token });
