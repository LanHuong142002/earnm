import type { TaskStatus } from "../tasks/types";

export const IDEA_STATUSES = ["new", "considering", "accepted", "dropped"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

/** A person's vote on an idea: down, none, up. */
export type Vote = -1 | 0 | 1;

export type IdeaAuthor = { id: string; displayName: string };

/** The task made from an accepted idea, as the API sends it. */
export type IdeaTask = { id: string; title: string; status: TaskStatus };

/** An idea exactly as the API returns it (contract: spec R1-R5, R9, R12). */
export type Idea = {
  id: string;
  projectId: string;
  /** Null once the author's account is gone: shown as "Người dùng cũ". */
  author: IdeaAuthor | null;
  title: string;
  description: string;
  status: IdeaStatus;
  labelIds: string[];
  /** Up votes minus down votes, from everyone. */
  score: number;
  /** Only the viewer's own vote. */
  myVote: Vote;
  commentCount: number;
  photoCount: number;
  taskId: string | null;
  task: IdeaTask | null;
  createdAt: string;
};
