export type TaskStatus = "todo" | "doing" | "done";
export type ProjectRole = "owner" | "member";

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "done"];

export type TaskAssignee = { id: string; displayName: string };

/** Same shape the API returns (spec R1, R7). */
export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** Calendar day, `YYYY-MM-DD`, no time zone. */
  dueDate: string | null;
  /** `HH:mm`, only with a dueDate. */
  dueTime: string | null;
  assignees: TaskAssignee[];
  createdById: string | null;
  createdAt: string;
};
