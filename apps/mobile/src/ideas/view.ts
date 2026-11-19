import type { Idea } from "./types";

/** The author's name, or the neutral `fallback` ("Người dùng cũ") once the account is gone (spec R6). */
export const ideaAuthorName = (idea: Pick<Idea, "author">, fallback: string): string => idea.author?.displayName ?? fallback;

/**
 * The create-task button of an idea (spec R12, R14, R15):
 * - `hidden`: the idea is not accepted.
 * - `available`: accepted with no task yet, and the phone is online.
 * - `needs_network`: accepted with no task yet but offline; the button is disabled with "Cần có mạng".
 * - `created`: the idea has its task; show "Đã tạo công việc" with the task instead.
 * A task made from the idea wins over the status, so a later status change never hides the link.
 */
export type CreateTaskState = "hidden" | "available" | "needs_network" | "created";

export function createTaskState(idea: Pick<Idea, "status" | "taskId">, online: boolean): CreateTaskState {
  if (idea.taskId !== null) return "created";
  if (idea.status !== "accepted") return "hidden";
  return online ? "available" : "needs_network";
}
