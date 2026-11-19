import type { LabelColour } from "../theme/tokens";

export type TaskStatus = "todo" | "doing" | "done";
export type ProjectRole = "owner" | "member";

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "done"];

export type TaskAssignee = { id: string; displayName: string };

export type ChecklistItem = { id: string; text: string; done: boolean; createdAt: string };

export type Checklist = { id: string; name: string; createdAt: string; items: ChecklistItem[] };

/** A project label (spec R5). `projectId` is set by the phone when it files the label under a project. */
export type Label = { id: string; projectId?: string; name: string; colour: LabelColour };

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
  /** Ids of this project's labels on the task. */
  labelIds: string[];
  checklists: Checklist[];
  /** The idea this task was made from (#11), while that idea exists. Absent in older saved copies. */
  fromIdea?: { id: string; title: string } | null;
};
