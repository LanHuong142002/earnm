import { ApiError } from "../lib/api";
import { resolveLabels } from "../tasks/labelDisplay";
import type { Label } from "../tasks/types";
import type { Idea } from "./types";

/**
 * What the New task form shows when it is opened from an idea (spec R12): the idea's title, description and labels,
 * and the idea's name for the line "Từ ý tưởng “…”". The server makes the task from the idea itself, so these are
 * shown as they will be saved, not edited.
 */
export type PrefilledTask = {
  ideaId: string;
  ideaTitle: string;
  title: string;
  description: string;
  /** In the idea's order; a label that no longer exists is left out. */
  labels: Label[];
};

export function prefilledTaskForm(idea: Pick<Idea, "id" | "title" | "description" | "labelIds">, labels: readonly Label[]): PrefilledTask {
  return {
    ideaId: idea.id,
    ideaTitle: idea.title,
    title: idea.title,
    description: idea.description,
    labels: resolveLabels(idea.labelIds, labels),
  };
}

/** The i18n key that explains why creating the task failed. Nothing is queued: the person tries again online. */
export function createTaskErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return "errors.generic";
  switch (error.code) {
    case "network":
      return "ideas.createTask.needsNetwork";
    case "idea_not_accepted":
      return "ideas.createTask.notAccepted";
    case "idea_already_has_task":
      return "ideas.createTask.alreadyHasTask";
    case "task_limit_reached":
      return "ideas.createTask.limit";
    case "not_found":
      return "ideas.createTask.gone";
    default:
      return "errors.generic";
  }
}
