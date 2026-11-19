import { describe, expect, it } from "vitest";

import { ideaNoticeKeys } from "./outcomes";

describe("ideaNoticeKeys", () => {
  it("names the idea when it is known", () => {
    expect(ideaNoticeKeys({ kind: "update", ideaTitle: "Trà", reason: "forbidden" })).toEqual({
      headline: "ideas.rejected",
      reason: "ideas.reasons.forbidden",
    });
  });
  it("copes with an unknown title", () => {
    expect(ideaNoticeKeys({ kind: "update", ideaTitle: null, reason: "generic" }).headline).toBe("ideas.rejectedNoTitle");
  });
  it("says a refused create is a create, and a 404 on it means the project is gone", () => {
    expect(ideaNoticeKeys({ kind: "create", ideaTitle: "Trà", reason: "not_found" })).toEqual({
      headline: "ideas.rejectedCreate",
      reason: "ideas.reasons.projectGone",
    });
    expect(ideaNoticeKeys({ kind: "create", ideaTitle: null, reason: "limit" }).headline).toBe("ideas.rejectedCreateNoTitle");
  });
  it("tells a refused delete apart", () => {
    expect(ideaNoticeKeys({ kind: "delete", ideaTitle: "Trà", reason: "forbidden" }).reason).toBe("ideas.reasons.forbiddenDelete");
  });
  it("gives every idea reason its own wording", () => {
    for (const reason of ["forbidden", "not_found", "conflict", "invalid", "limit", "generic"] as const) {
      expect(ideaNoticeKeys({ kind: "update", ideaTitle: "x", reason }).reason).toMatch(/^ideas\.reasons\./);
    }
  });
});
