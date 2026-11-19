import type { IngredientRejectedNotice, IngredientRejectedReason } from "./syncCycle";

const REASON_KEY: Partial<Record<IngredientRejectedReason, string>> = {
  forbidden: "ingredients.reasons.forbidden",
  not_found: "ingredients.reasons.notFound",
  conflict: "ingredients.reasons.conflict",
  invalid: "ingredients.reasons.invalid",
  limit: "ingredients.reasons.limit",
  nameTaken: "ingredients.reasons.nameTaken",
  inUse: "ingredients.reasons.inUse",
  generic: "ingredients.reasons.generic",
};

/** The i18n keys of the rejected-ingredient notice: its headline (takes `{{name}}`) and the reason line. */
export function ingredientNoticeKeys(notice: IngredientRejectedNotice): { headline: string; reason: string } {
  const named = notice.ingredientName !== null;
  // Reasons only labels, checklists and reminders can have never apply here, so they read as generic.
  let reason = REASON_KEY[notice.reason] ?? "ingredients.reasons.generic";
  // A refused create answered 404 means the project is gone; there is no ingredient yet to have "disappeared".
  if (notice.kind === "create" && notice.reason === "not_found") reason = "ingredients.reasons.projectGone";
  if (notice.kind === "create") {
    return { headline: named ? "ingredients.rejectedCreate" : "ingredients.rejectedCreateNoName", reason };
  }
  return { headline: named ? "ingredients.rejected" : "ingredients.rejectedNoName", reason };
}
