import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { recoveredConvert, runConvert, shouldRefreshAfter } from "./convert";
import { draft } from "./fixtures";

function setup(convertDraft: (...args: unknown[]) => Promise<unknown>, token: string | null = "tok") {
  const deps = {
    getToken: vi.fn(async () => token),
    convertDraft: vi.fn(convertDraft) as never,
  };
  return deps;
}

describe("converting a draft", () => {
  it("returns the product and which ingredients were created and reused", async () => {
    const deps = setup(async () => ({
      productId: "pr1",
      draft: draft({ id: "d1", productId: "pr1" }),
      createdIngredients: [{ id: "i1", name: "Vải" }],
      reusedIngredients: [{ id: "i2", name: "Trà" }],
    }));
    const result = await runConvert(deps, "p1", "d1");
    expect(result).toEqual({ ok: true, productId: "pr1", created: [{ id: "i1", name: "Vải" }], reused: [{ id: "i2", name: "Trà" }] });
    expect(deps.convertDraft).toHaveBeenCalledWith("tok", "p1", "d1");
  });

  it("reports an incomplete draft with its missing list", async () => {
    const missing = [{ code: "line_price", lineId: "l1", name: "Vải" }, { code: "lines" }];
    const deps = setup(async () => {
      throw new ApiError("draft_incomplete", 409, null, { missing });
    });
    expect(await runConvert(deps, "p1", "d1")).toEqual({ ok: false, code: "draft_incomplete", missing });
  });

  it.each(["draft_not_done", "draft_converted", "product_name_taken", "product_limit_reached", "ingredient_limit_reached"])("reports %s by its code", async (code) => {
    const deps = setup(async () => {
      throw new ApiError(code, 409);
    });
    expect(await runConvert(deps, "p1", "d1")).toEqual({ ok: false, code });
  });

  it("carries the ingredient name for a mode mismatch", async () => {
    const deps = setup(async () => {
      throw new ApiError("draft_ingredient_mode_mismatch", 409, null, { lineId: "l1", name: "Sữa" });
    });
    expect(await runConvert(deps, "p1", "d1")).toEqual({ ok: false, code: "draft_ingredient_mode_mismatch", name: "Sữa" });
  });

  it("reports offline when the network fails, and does not call without a token", async () => {
    const offline = setup(async () => {
      throw new ApiError("network");
    });
    expect(await runConvert(offline, "p1", "d1")).toEqual({ ok: false, code: "offline" });
    const signedOut = setup(async () => ({}), null);
    expect(await runConvert(signedOut, "p1", "d1")).toEqual({ ok: false, code: "not_signed_in" });
    expect(signedOut.convertDraft).not.toHaveBeenCalled();
  });

  it("treats a reply of the wrong shape as an error", async () => {
    const deps = setup(async () => ({ nope: true }));
    expect(await runConvert(deps, "p1", "d1")).toEqual({ ok: false, code: "internal_error" });
  });
});

describe("recoveredConvert", () => {
  const converted = draft({ id: "d1", productId: "pr1", convertedAt: "2026-11-11T00:00:00.000Z" });
  it("turns an already-converted or lost reply into ok when the refreshed draft has a product", () => {
    for (const code of ["draft_converted", "offline"]) {
      expect(recoveredConvert({ ok: false, code }, converted)).toEqual({ ok: true, productId: "pr1", created: [], reused: [] });
    }
  });
  it("keeps the failure when the draft has no product, the code is another one, or the draft is gone", () => {
    expect(recoveredConvert({ ok: false, code: "offline" }, draft({ id: "d1" }))).toBeNull();
    expect(recoveredConvert({ ok: false, code: "draft_not_done" }, converted)).toBeNull();
    expect(recoveredConvert({ ok: false, code: "draft_converted" }, undefined)).toBeNull();
  });
  it("says which failures are worth refreshing for", () => {
    expect(shouldRefreshAfter("draft_converted")).toBe(true);
    expect(shouldRefreshAfter("offline")).toBe(true);
    expect(shouldRefreshAfter("pending")).toBe(false);
  });
});
