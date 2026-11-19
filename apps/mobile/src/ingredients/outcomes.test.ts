import { describe, expect, it } from "vitest";

import { ingredientNoticeKeys } from "./outcomes";

describe("ingredientNoticeKeys", () => {
  it("names the ingredient when it is known", () => {
    expect(ingredientNoticeKeys({ kind: "update", ingredientName: "Trà đen", reason: "nameTaken" })).toEqual({
      headline: "ingredients.rejected",
      reason: "ingredients.reasons.nameTaken",
    });
  });

  it("has a headline for an unnamed ingredient", () => {
    expect(ingredientNoticeKeys({ kind: "delete", ingredientName: null, reason: "forbidden" }).headline).toBe(
      "ingredients.rejectedNoName",
    );
  });

  it("says the project is gone when a create is answered not found", () => {
    expect(ingredientNoticeKeys({ kind: "create", ingredientName: "Đường", reason: "not_found" })).toEqual({
      headline: "ingredients.rejectedCreate",
      reason: "ingredients.reasons.projectGone",
    });
  });

  it("reads the 300 limit and falls back to generic for other reasons", () => {
    expect(ingredientNoticeKeys({ kind: "create", ingredientName: null, reason: "limit" }).reason).toBe("ingredients.reasons.limit");
    expect(ingredientNoticeKeys({ kind: "update", ingredientName: null, reason: "labelLimit" }).reason).toBe(
      "ingredients.reasons.generic",
    );
  });
});
