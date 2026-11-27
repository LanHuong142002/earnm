import { ApiError } from "../lib/api";
import { DRAFT_NAME_MAX, DRAFT_NOTE_MAX } from "../drafts/view";
import type { Idea } from "./types";

/**
 * What the New draft form shows when it is opened from an idea (spec R2): the name from the idea's title, the note
 * from its description, and how many photos will come along. The server makes the draft, so name and note can be
 * edited first; the sizes start as on the plain form.
 */
export type PrefilledDraft = {
  ideaId: string;
  ideaTitle: string;
  name: string;
  note: string;
  photoCount: number;
};

/** The idea's title cut to the draft name limit, at a word boundary when there is one. Counts characters, not code units. */
export function draftNameFromTitle(title: string): string {
  const chars = [...title.trim()];
  if (chars.length <= DRAFT_NAME_MAX) return chars.join("");
  const head = chars.slice(0, DRAFT_NAME_MAX);
  // A boundary exists when the cut falls on a space, or a space sits inside the kept part.
  if (/\s/.test(chars[DRAFT_NAME_MAX] ?? "")) return head.join("").trimEnd();
  const lastSpace = head.findLastIndex((c) => /\s/.test(c));
  return lastSpace > 0 ? head.slice(0, lastSpace).join("").trimEnd() : head.join("");
}

export function prefilledDraftForm(idea: Pick<Idea, "id" | "title" | "description" | "photoCount">): PrefilledDraft {
  return {
    ideaId: idea.id,
    ideaTitle: idea.title,
    name: draftNameFromTitle(idea.title),
    note: [...idea.description].slice(0, DRAFT_NOTE_MAX).join(""),
    photoCount: idea.photoCount,
  };
}

/** Why a draft cannot be made from this idea now (the button is off and says so), or null when it can. */
export function ideaDraftBlock(idea: Pick<Idea, "status" | "draftId">): string | null {
  if (idea.draftId !== null) return "ideas.createDraft.alreadyHasDraft";
  if (idea.status !== "accepted") return "ideas.createDraft.notAccepted";
  return null;
}

/** The i18n key that explains why creating the draft failed. Nothing is queued: the person tries again online. */
export function createDraftErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return "errors.generic";
  switch (error.code) {
    case "network":
      return "ideas.createDraft.needsNetwork";
    case "idea_not_accepted":
      return "ideas.createDraft.notAccepted";
    case "idea_already_has_draft":
      return "ideas.createDraft.alreadyHasDraft";
    case "draft_limit_reached":
      return "ideas.createDraft.limit";
    case "id_conflict":
      return "ideas.createDraft.conflict";
    case "not_found":
      return "ideas.createDraft.gone";
    default:
      return "errors.generic";
  }
}
