import { request } from "../../lib/api";
import type { ProjectReminders, ReminderSchedule, ServerReminder } from "./types";

type Stamped<T> = { value: T; editedAt: string };

/** The schedule and the recipients each have their own time, so they merge separately on the server. */
export type ReminderFieldPatch = { schedule?: Stamped<ReminderSchedule>; recipients?: Stamped<string[]> };

export type CreateReminderBody = ReminderSchedule & { id: string; recipientIds: string[] };

const base = (projectId: string, taskId: string) =>
  `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/reminders`;

export const listProjectReminders = (token: string, projectId: string) =>
  request<ProjectReminders>(`/projects/${encodeURIComponent(projectId)}/reminders`, { token });

export const createReminder = (token: string, projectId: string, taskId: string, body: CreateReminderBody) =>
  request<ServerReminder>(base(projectId, taskId), { method: "POST", body, token });

export const patchReminder = (token: string, projectId: string, taskId: string, reminderId: string, fields: ReminderFieldPatch) =>
  request<ServerReminder>(`${base(projectId, taskId)}/${encodeURIComponent(reminderId)}`, { method: "PATCH", body: fields, token });

export const deleteReminder = (token: string, projectId: string, taskId: string, reminderId: string) =>
  request<void>(`${base(projectId, taskId)}/${encodeURIComponent(reminderId)}`, { method: "DELETE", token });
