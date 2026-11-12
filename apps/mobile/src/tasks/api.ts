import { request } from "../lib/api";
import type { Task, TaskStatus } from "./types";

export type CreateTaskBody = {
  id: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  dueDate?: string;
  dueTime?: string;
  assigneeIds?: string[];
  editedAt: string;
};

export type TaskField = "title" | "description" | "status" | "due" | "assignees";

type Stamped<T> = { value: T; editedAt: string };

/** `due.value` is the day and time together, or null to clear both; `assignees.value` is the whole set of user ids. */
export type TaskFieldPatch = {
  title?: Stamped<string>;
  description?: Stamped<string>;
  status?: Stamped<TaskStatus>;
  due?: Stamped<{ date: string; time: string | null } | null>;
  assignees?: Stamped<string[]>;
};

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/tasks`;

export const listTasks = (token: string, projectId: string) => request<Task[]>(base(projectId), { token });

export const createTask = (token: string, projectId: string, body: CreateTaskBody) =>
  request<Task>(base(projectId), { method: "POST", body, token });

export const patchTask = (token: string, projectId: string, taskId: string, fields: TaskFieldPatch) =>
  request<Task>(`${base(projectId)}/${encodeURIComponent(taskId)}`, { method: "PATCH", body: { fields }, token });

export const deleteTask = (token: string, projectId: string, taskId: string) =>
  request<void>(`${base(projectId)}/${encodeURIComponent(taskId)}`, { method: "DELETE", token });
