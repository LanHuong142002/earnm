import { request } from "../lib/api";

export type ActivityType = "assigned" | "comment" | "done" | "idea" | "member_joined";

export type ActivityItem = {
  id: string;
  type: ActivityType;
  actorName: string | null;
  subjectTitle: string | null;
  projectId: string;
  projectName: string | null;
  taskId: string | null;
  ideaId: string | null;
  memberId: string | null;
  memberName: string | null;
  occurredAt: string;
  read: boolean;
};

export type ActivityPage = { items: ActivityItem[]; nextCursor: string | null };

/** One page of the person's activity feed, newest first (R29). `cursor` is the previous page's `nextCursor`. */
export const listActivity = (token: string, cursor?: string | null) =>
  request<ActivityPage>(cursor ? `/me/activity?cursor=${encodeURIComponent(cursor)}` : "/me/activity", { token });

export const getActivityUnread = (token: string) => request<{ hasUnread: boolean }>("/me/activity/unread", { token });

/** The server accepts 1 to 100 event ids per call. */
export const markActivityRead = (token: string, eventIds: string[]) =>
  request<void>("/me/activity/read", { method: "POST", body: { eventIds }, token });

export const markAllActivityRead = (token: string) => request<void>("/me/activity/read-all", { method: "POST", token });
