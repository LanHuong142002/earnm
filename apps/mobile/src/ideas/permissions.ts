import type { ProjectRole } from "../tasks/types";
import type { Idea } from "./types";

/**
 * Spec R2: the author and the project's Owners change the title, description and labels, manage the photos and
 * delete the idea. An idea whose author is gone can only be changed by an Owner. Anyone may set the status,
 * vote and comment.
 */
export function canEditIdea(idea: Pick<Idea, "author">, myId: string, myRole: ProjectRole): boolean {
  if (myRole === "owner") return true;
  return idea.author !== null && idea.author.id === myId;
}
