import { ApiError } from "../lib/api";
import type { ConvertReply } from "./api";
import { missingOf } from "./syncCycle";
import type { IngredientRef, ServerMissing } from "./types";

/**
 * The outcome of converting a draft. `code` is the server's error code, or `offline` (no network), `not_signed_in`,
 * `pending` (changes to this draft are still waiting to be sent, so the server would convert an older copy) or
 * `internal_error` (an unreadable reply). `missing` is set for `draft_incomplete`.
 */
export type ConvertResult =
  | { ok: true; productId: string; created: IngredientRef[]; reused: IngredientRef[] }
  | { ok: false; code: string; missing?: ServerMissing[] };

type ConvertDeps = {
  getToken: () => Promise<string | null>;
  convertDraft: (token: string, projectId: string, draftId: string) => Promise<ConvertReply>;
};

const isRefs = (v: unknown): v is IngredientRef[] =>
  Array.isArray(v) && v.every((r) => typeof r === "object" && r !== null && typeof (r as IngredientRef).id === "string" && typeof (r as IngredientRef).name === "string");

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
    return { ok: false, code: error.code };
  }
}
