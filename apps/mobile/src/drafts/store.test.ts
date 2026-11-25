import { describe, expect, it } from "vitest";

import { draft } from "./fixtures";
import { convertedTotalOf, emptyDraftCache, pruneDraftCache, setProjectDrafts } from "./store";

describe("the converted total in the draft cache", () => {
  it("is kept per project, kept when a later save has none, and pruned with the project", () => {
    let cache = setProjectDrafts(emptyDraftCache("u"), "p1", [draft({ id: "d1" })], 73);
    expect(convertedTotalOf(cache, "p1")).toBe(73);
    cache = setProjectDrafts(cache, "p1", [draft({ id: "d1" }), draft({ id: "d2" })]);
    expect(convertedTotalOf(cache, "p1")).toBe(73);
    expect(convertedTotalOf(cache, "p2")).toBeNull();
    expect(convertedTotalOf(pruneDraftCache(cache, ["p2"]), "p1")).toBeNull();
  });

  it("reads an old cache that has no totals", () => {
    expect(convertedTotalOf({ ownerId: "u", byProject: { p1: [] } }, "p1")).toBeNull();
  });
});
