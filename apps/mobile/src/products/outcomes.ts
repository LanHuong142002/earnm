import type { ProductRejectedNotice, ProductRejectedReason } from "./syncCycle";

const REASON_KEY: Partial<Record<ProductRejectedReason, string>> = {
  forbidden: "products.reasons.forbidden",
  not_found: "products.reasons.notFound",
  conflict: "products.reasons.conflict",
  invalid: "products.reasons.invalid",
  limit: "products.reasons.limit",
  nameTaken: "products.reasons.nameTaken",
  generic: "products.reasons.generic",
};

/** The i18n keys of the rejected-product notice: its headline (takes `{{name}}`) and the reason line. */
export function productNoticeKeys(notice: ProductRejectedNotice): { headline: string; reason: string } {
  const named = notice.name !== null;
  const extra = notice.entity === "extraCost";
  let reason = REASON_KEY[notice.reason] ?? "products.reasons.generic";
  // The extra costs have their own wording for what no longer exists and for the limit.
  if (extra && notice.reason === "not_found") reason = "products.reasons.notFoundExtra";
  if (extra && notice.reason === "limit") reason = "products.reasons.limitExtra";
  // A refused create answered 404 means the project is gone; there is nothing yet to have "disappeared".
  if (notice.kind === "create" && notice.reason === "not_found") reason = "products.reasons.projectGone";
  const base = extra ? "products.rejectedExtra" : "products.rejected";
  if (notice.kind === "create") return { headline: `${base}Create${named ? "" : "NoName"}`, reason };
  return { headline: `${base}${named ? "" : "NoName"}`, reason };
}
