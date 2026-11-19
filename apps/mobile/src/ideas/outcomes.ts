import type { RejectedReason } from "../tasks/outcomes";
import type { IdeaRejectedNotice } from "./syncCycle";

const REASON_KEY: Record<RejectedReason, string> = {
  forbidden: "ideas.reasons.forbidden",
  not_found: "ideas.reasons.notFound",
  conflict: "ideas.reasons.conflict",
  invalid: "ideas.reasons.invalid",
  limit: "ideas.reasons.limit",
  generic: "ideas.reasons.generic",
  // Reasons only labels, checklists, items and reminders can have: an idea never gets them, so they read as generic.
  labelNameTaken: "ideas.reasons.generic",
  labelLimit: "ideas.reasons.generic",
  checklistLimit: "ideas.reasons.generic",
  itemLimit: "ideas.reasons.generic",
  reminderLimit: "ideas.reasons.generic",
};

/** The i18n keys of the rejected-idea notice: its headline (takes `{{title}}`) and the reason line. */
export function ideaNoticeKeys(notice: IdeaRejectedNotice): { headline: string; reason: string } {
  const named = notice.ideaTitle !== null;
  let reason = REASON_KEY[notice.reason];
  if (notice.kind === "delete" && notice.reason === "forbidden") reason = "ideas.reasons.forbiddenDelete";
  // A refused create answered 404 means the project is gone; there is no idea yet to have "disappeared".
  if (notice.kind === "create" && notice.reason === "not_found") reason = "ideas.reasons.projectGone";
  if (notice.kind === "create") return { headline: named ? "ideas.rejectedCreate" : "ideas.rejectedCreateNoTitle", reason };
  return { headline: named ? "ideas.rejected" : "ideas.rejectedNoTitle", reason };
}
