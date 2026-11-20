import type { DraftRejectedNotice, DraftRejectedReason } from "./syncCycle";

const REASON_KEY: Partial<Record<DraftRejectedReason, string>> = {
  forbidden: "drafts.reasons.forbidden",
  not_found: "drafts.reasons.notFound",
  conflict: "drafts.reasons.conflict",
  invalid: "drafts.reasons.invalid",
  limit: "drafts.reasons.limit",
  nameTaken: "drafts.reasons.nameTaken",
  converted: "drafts.reasons.converted",
  duplicateLine: "drafts.reasons.duplicateLine",
  incomplete: "drafts.reasons.incomplete",
  generic: "drafts.reasons.generic",
};

/** The i18n keys of the rejected-draft notice: its headline (takes `{{name}}`) and the reason line. */
export function draftNoticeKeys(notice: DraftRejectedNotice): { headline: string; reason: string } {
  const named = notice.name !== null;
  let reason = REASON_KEY[notice.reason] ?? "drafts.reasons.generic";
  // A refused create answered 404 means the project is gone; there is nothing yet to have "disappeared".
  if (notice.kind === "create" && notice.entity === "draft" && notice.reason === "not_found") reason = "drafts.reasons.projectGone";
  const suffix = named ? "" : "NoName";
  if (notice.entity === "draftStatus") return { headline: `drafts.rejectedStatus${suffix}`, reason };
  if (notice.entity === "draftLine") return { headline: `drafts.rejectedLine${suffix}`, reason };
  if (notice.kind === "create") return { headline: `drafts.rejectedCreate${suffix}`, reason };
  return { headline: `drafts.rejected${suffix}`, reason };
}
