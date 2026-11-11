import { describe, expect, it } from "vitest";

import type { Change } from "../sync/queue";
import type { Project } from "./api";
import { changedFields, ownershipDecision, planUpdate, withApplied } from "./optimistic";

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

describe("editing only what the person changed (R13)", () => {
  it("form opened on name A, cache now B, only the description edited: only description is queued", () => {
    const opened = { name: "A", description: "", currency: "VND" as const };
    const submitted = { name: "A", description: "new text", currency: "VND" as const };
    const fields = changedFields({ ...p("1"), ...opened }, submitted);
    expect(fields).toEqual({ description: "new text" });
    const cacheNow = p("1", "B");
    const plan = planUpdate(cacheNow, fields);
    expect(plan).toEqual({ ok: true, changed: { description: "new text" } });
  });

  it("an unchanged save queues nothing", () => {
    const opened = { name: "A", description: "", currency: "VND" as const };
    expect(changedFields({ ...p("1"), ...opened }, opened)).toEqual({});
    expect(planUpdate(p("1", "B"), {})).toEqual({ ok: true, changed: {} });
  });

  it("sends exactly the given fields, trimmed, even if equal to the cache", () => {
    expect(planUpdate(p("1", "B"), { name: " B " })).toEqual({ ok: true, changed: { name: "B" } });
  });

  it("validates the merged result", () => {
    expect(planUpdate(p("1"), { name: "  " })).toEqual({ ok: false, errors: { name: "required" } });
  });
});
