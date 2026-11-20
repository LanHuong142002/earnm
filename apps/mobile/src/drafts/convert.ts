import { ApiError } from "../lib/api";
import type { ConvertReply } from "./api";
import { missingOf } from "./syncCycle";
import type { IngredientRef, ServerMissing } from "./types";

/**
 * The outcome of converting a draft. `code` is the server's error code, or `offline` (no network), `not_signed_in`,
 * `pending` (changes to this draft are still waiting to be sent, so the server would convert an older copy) or
 * `internal_error` (an unreadable reply). `missing` is set for `draft_incomplete`, `name` (the ingredient) for `draft_ingredient_mode_mismatch` and `draft_line_amount_too_large`.
 */
export type ConvertResult =
  | { ok: true; productId: string; created: IngredientRef[]; reused: IngredientRef[] }
  | { ok: false; code: string; missing?: ServerMissing[]; name?: string };

type ConvertDeps = {
  getToken: () => Promise<string | null>;
  convertDraft: (token: string, projectId: string, draftId: string) => Promise<ConvertReply>;
};

const isRefs = (v: unknown): v is IngredientRef[] =>
  Array.isArray(v) && v.every((r) => typeof r === "object" && r !== null && typeof (r as IngredientRef).id === "string" && typeof (r as IngredientRef).name === "string");

/** After these the server may have converted the draft (a repeat tap, or a reply lost on the way): refresh and look. */
export const shouldRefreshAfter = (code: string): boolean => code === "draft_converted" || code === "offline";

/** When the refreshed draft already has a product, the convert did happen: link to it instead of showing the failure. */
export function recoveredConvert(failed: Extract<ConvertResult, { ok: false }>, fresh: { productId: string | null } | undefined): ConvertResult | null {
  if (!shouldRefreshAfter(failed.code) || !fresh?.productId) return null;
  return { ok: true, productId: fresh.productId, created: [], reused: [] };
}

/** Converting needs the network and is never queued. */
export async function runConvert(deps: ConvertDeps, projectId: string, draftId: string): Promise<ConvertResult> {
  const token = await deps.getToken();
  if (!token) return { ok: false, code: "not_signed_in" };
  try {
    const reply = await deps.convertDraft(token, projectId, draftId);
    if (typeof reply?.productId !== "string" || !isRefs(reply.createdIngredients) || !isRefs(reply.reusedIngredients)) {
      return { ok: false, code: "internal_error" };
    }
    return { ok: true, productId: reply.productId, created: reply.createdIngredients, reused: reply.reusedIngredients };
  } catch (error) {
    if (!(error instanceof ApiError)) return { ok: false, code: "internal_error" };
    if (error.code === "network") return { ok: false, code: "offline" };
    if (error.code === "draft_incomplete") return { ok: false, code: error.code, missing: missingOf(error) };
    if (error.code === "draft_ingredient_mode_mismatch" || error.code === "draft_line_amount_too_large") {
      const name = error.details?.name;
      return typeof name === "string" ? { ok: false, code: error.code, name } : { ok: false, code: error.code };
    }
    return { ok: false, code: error.code };
  }
}
