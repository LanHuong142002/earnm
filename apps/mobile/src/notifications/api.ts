import { request } from "../lib/api";

export type NotificationType = "assigned" | "comment" | "done" | "idea" | "member_joined";

export const NOTIFICATION_TYPES: readonly NotificationType[] = ["assigned", "comment", "done", "idea", "member_joined"];

export type NotificationSettings = {
  types: Record<NotificationType, boolean>;
  mutedProjectIds: string[];
};

export const getNotificationSettings = (token: string) =>
  request<NotificationSettings>("/me/notification-settings", { token });

export const putNotificationType = (token: string, type: NotificationType, enabled: boolean) =>
  request<NotificationSettings>(`/me/notification-settings/types/${encodeURIComponent(type)}`, {
    method: "PUT",
    body: { enabled },
    token,
  });

export const putProjectMute = (token: string, projectId: string, muted: boolean) =>
  request<{ muted: boolean }>(`/projects/${encodeURIComponent(projectId)}/notification-mute`, {
    method: "PUT",
    body: { muted },
    token,
  });
