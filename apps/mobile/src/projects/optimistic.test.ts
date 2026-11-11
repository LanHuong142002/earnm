import { describe, expect, it } from "vitest";

import type { Change } from "../sync/queue";
import type { Project } from "./api";
import { changedFields, ownershipDecision, withApplied } from "./optimistic";

const p = (id: string, name = "A"): Project => ({ id, name, description: "", currency: "VND", role: "owner" });
const change = (kind: Change["kind"], entityId: string): Change => ({
  changeId: "c", entity: "project", entityId, kind, data: {}, fieldTimes: {}, createdAt: "2026-01-01T00:00:00.000Z",
});

describe("changedFields", () => {
  it("keeps only differing fields", () => {
    expect(changedFields(p("1"), { name: "A", description: "x", currency: "VND" })).toEqual({ description: "x" });
  });
  it("is empty when nothing changed", () => {
    expect(changedFields(p("1"), { name: "A" })).toEqual({});
  });
});

describe("withApplied", () => {
  it("replaces on update", () => {
    expect(withApplied([p("1"), p("2")], change("update", "1"), p("1", "B"))[0].name).toBe("B");
  });
  it("adds on create", () => {
    expect(withApplied([p("1")], change("create", "2"), p("2")).map((x) => x.id)).toEqual(["1", "2"]);
  });
  it("removes on delete", () => {
    expect(withApplied([p("1"), p("2")], change("delete", "1"), undefined).map((x) => x.id)).toEqual(["2"]);
  });
});

describe("ownershipDecision", () => {
  it("clears the cache when the queue was cleared", () => {
    expect(ownershipDecision("b", true, "b")).toBe("clear");
  });
  it("clears the cache when it belongs to someone else", () => {
    expect(ownershipDecision("a", false, "b")).toBe("clear");
    expect(ownershipDecision("a", false, "a")).toBe("keep");
  });
  it("keeps an empty cache", () => {
    expect(ownershipDecision(null, false, "a")).toBe("keep");
  });
});
