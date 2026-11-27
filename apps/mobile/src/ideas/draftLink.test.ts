import { describe, expect, it } from "vitest";

import { draftButtonState, draftStatusKey, photosNotCopiedCount } from "./draftLink";

const accepted = { status: "accepted" as const, draftId: null, draft: null };

describe("draftButtonState", () => {
  it("offers the button for an accepted idea without a draft", () => {
    expect(draftButtonState(accepted)).toBe("available");
  });
  it("shows the link once the idea has a draft", () => {
    const draft = { id: "d1", name: "Trà", status: "working" as const, convertedAt: null };
    expect(draftButtonState({ status: "accepted", draftId: "d1", draft })).toBe("linked");
  });
  it("shows neither while the idea knows a draft id but not the draft itself", () => {
    expect(draftButtonState({ status: "accepted", draftId: "d1", draft: null })).toBe("none");
  });
  it("shows no button for an idea that is not accepted", () => {
    expect(draftButtonState({ ...accepted, status: "new" })).toBe("none");
  });
  it("still shows the link when the idea moved off accepted after the draft was made", () => {
    const draft = { id: "d1", name: "Trà", status: "done" as const, convertedAt: null };
    expect(draftButtonState({ status: "new", draftId: "d1", draft })).toBe("linked");
  });
});

describe("draftStatusKey", () => {
  it("says working, done, or converted (converted wins)", () => {
    expect(draftStatusKey({ status: "working", convertedAt: null })).toBe("drafts.statusWorking");
    expect(draftStatusKey({ status: "done", convertedAt: null })).toBe("drafts.statusDone");
    expect(draftStatusKey({ status: "done", convertedAt: "2026-11-20T00:00:00Z" })).toBe("drafts.statusConverted");
  });
});

describe("photosNotCopiedCount", () => {
  it("reads a positive whole number from the route param", () => {
    expect(photosNotCopiedCount("2")).toBe(2);
  });
  it("is 0 for a missing, zero, negative, fractional or junk value", () => {
    for (const v of [undefined, "", "0", "-1", "1.5", "abc", "2x", ["3"]]) expect(photosNotCopiedCount(v as never)).toBe(0);
  });
});
