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

/**
 * How many whole characters of `chars` fit in `max` UTF-16 code units, the unit the forms and the server count in
 * (`string.length`, zod `.max`). A character is never split, so an emoji (two units) either fits whole or is left out.
 */
function fitting(chars: readonly string[], max: number): number {
  let units = 0;
  let count = 0;
  for (const c of chars) {
    if (units + c.length > max) break;
    units += c.length;
    count++;
  }
  return count;
}

/** `text` cut to at most `max` UTF-16 code units without splitting a character. */
export function capUnits(text: string, max: number): string {
  const chars = [...text];
  return chars.slice(0, fitting(chars, max)).join("");
}

/**
 * `text` trimmed and cut to at most `max` UTF-16 code units (what the forms and the server check), at a word
 * boundary when there is one, never splitting a character.
 */
export function cutAtWord(text: string, max: number): string {
  const chars = [...text.trim()];
  const keep = fitting(chars, max);
  if (keep === chars.length) return chars.join("");
  const head = chars.slice(0, keep);
  // A boundary exists when the cut falls on a space, or a space sits inside the kept part.
  if (/\s/.test(chars[keep] ?? "")) return head.join("").trimEnd();
  const lastSpace = head.findLastIndex((c) => /\s/.test(c));
  return lastSpace > 0 ? head.slice(0, lastSpace).join("").trimEnd() : head.join("");
}

/** The idea's title cut to the draft name limit, at a word boundary when there is one. */
export function draftNameFromTitle(title: string): string {
  return cutAtWord(title, DRAFT_NAME_MAX);
}

export function prefilledDraftForm(idea: Pick<Idea, "id" | "title" | "description" | "photoCount">): PrefilledDraft {
  return {
    ideaId: idea.id,
    ideaTitle: idea.title,
    name: draftNameFromTitle(idea.title),
    note: capUnits(idea.description, DRAFT_NOTE_MAX),
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
