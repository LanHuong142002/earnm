import { request } from "../lib/api";
import type { LabelColour } from "../theme/tokens";
import type { Checklist, ChecklistItem, Label, Task, TaskStatus } from "./types";

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

export type TaskField = "title" | "description" | "status" | "due" | "assignees" | "labels";

type Stamped<T> = { value: T; editedAt: string };

/** `due.value` is the day and time together, or null to clear both; `assignees.value` is the whole set of user ids. */
export type TaskFieldPatch = {
  title?: Stamped<string>;
  description?: Stamped<string>;
  status?: Stamped<TaskStatus>;
  due?: Stamped<{ date: string; time: string | null } | null>;
  assignees?: Stamped<string[]>;
  /** The whole set of label ids on the task. */
  labels?: Stamped<string[]>;
};

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/tasks`;

export const listTasks = (token: string, projectId: string) =>
  request<Task[]>(base(projectId), { token });

export const createTask = (token: string, projectId: string, body: CreateTaskBody) =>
  request<Task>(base(projectId), { method: "POST", body, token });

export const patchTask = (token: string, projectId: string, taskId: string, fields: TaskFieldPatch) =>
  request<Task>(`${base(projectId)}/${encodeURIComponent(taskId)}`, { method: "PATCH", body: { fields }, token });

export const deleteTask = (token: string, projectId: string, taskId: string) =>
  request<void>(`${base(projectId)}/${encodeURIComponent(taskId)}`, { method: "DELETE", token });

/** Labels (spec R5). */
export type LabelFieldPatch = { name?: Stamped<string>; colour?: Stamped<LabelColour> };

const labelsBase = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/labels`;

export const listLabels = (token: string, projectId: string) => request<Label[]>(labelsBase(projectId), { token });

export const createLabel = (
  token: string,
  projectId: string,
  body: { id: string; name: string; colour: LabelColour; editedAt: string },
) => request<Label>(labelsBase(projectId), { method: "POST", body, token });

export const patchLabel = (token: string, projectId: string, labelId: string, fields: LabelFieldPatch) =>
  request<Label>(`${labelsBase(projectId)}/${encodeURIComponent(labelId)}`, { method: "PATCH", body: { fields }, token });

export const deleteLabel = (token: string, projectId: string, labelId: string) =>
  request<void>(`${labelsBase(projectId)}/${encodeURIComponent(labelId)}`, { method: "DELETE", token });

/** Checklists and their items (spec R1, R2). */
const checklistsBase = (projectId: string, taskId: string) =>
  `${base(projectId)}/${encodeURIComponent(taskId)}/checklists`;

export const createChecklist = (
  token: string,
  projectId: string,
  taskId: string,
  body: { id: string; name: string; editedAt: string },
) => request<Checklist>(checklistsBase(projectId, taskId), { method: "POST", body, token });

export const patchChecklist = (
  token: string,
  projectId: string,
  taskId: string,
  checklistId: string,
  fields: { name: Stamped<string> },
) =>
  request<Checklist>(`${checklistsBase(projectId, taskId)}/${encodeURIComponent(checklistId)}`, {
    method: "PATCH",
    body: { fields },
    token,
  });

export const deleteChecklist = (token: string, projectId: string, taskId: string, checklistId: string) =>
  request<void>(`${checklistsBase(projectId, taskId)}/${encodeURIComponent(checklistId)}`, { method: "DELETE", token });

const itemsBase = (projectId: string, taskId: string, checklistId: string) =>
  `${checklistsBase(projectId, taskId)}/${encodeURIComponent(checklistId)}/items`;

export type ChecklistItemFieldPatch = { text?: Stamped<string>; done?: Stamped<boolean> };

export const createChecklistItem = (
  token: string,
  projectId: string,
  taskId: string,
  checklistId: string,
  body: { id: string; text: string; editedAt: string },
) => request<ChecklistItem>(itemsBase(projectId, taskId, checklistId), { method: "POST", body, token });

export const patchChecklistItem = (
  token: string,
  projectId: string,
  taskId: string,
  checklistId: string,
  itemId: string,
  fields: ChecklistItemFieldPatch,
) =>
  request<ChecklistItem>(`${itemsBase(projectId, taskId, checklistId)}/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: { fields },
    token,
  });

export const deleteChecklistItem = (
  token: string,
  projectId: string,
  taskId: string,
  checklistId: string,
  itemId: string,
) => request<void>(`${itemsBase(projectId, taskId, checklistId)}/${encodeURIComponent(itemId)}`, { method: "DELETE", token });
