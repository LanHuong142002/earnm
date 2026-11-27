import type { Idea, IdeaDraft } from "./types";

/**
 * What the idea screen shows for the drink draft (mockups B1 and B3): the button when a draft can be made, the
 * link card once there is one, nothing otherwise. A draft id without the draft itself (not loaded yet) shows nothing
 * rather than a button that would be refused.
 */
export function draftButtonState(idea: Pick<Idea, "status" | "draftId" | "draft">): "available" | "linked" | "none" {
  if (idea.draft !== null) return "linked";
  if (idea.draftId !== null) return "none";
  return idea.status === "accepted" ? "available" : "none";
}

/** The i18n key of a draft's state on the idea screen: converted beats done and working. */
export function draftStatusKey(draft: Pick<IdeaDraft, "status" | "convertedAt">): string {
  if (draft.convertedAt !== null) return "drafts.statusConverted";
  return draft.status === "done" ? "drafts.statusDone" : "drafts.statusWorking";
}

/** How many photos could not be copied, from the `photosNotCopied` route param; 0 when it is missing or not a positive whole number. */
export function photosNotCopiedCount(param: string | undefined): number {
  if (typeof param !== "string" || !/^[1-9]\d{0,3}$/.test(param)) return 0;
  return Number(param);
}
