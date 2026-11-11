import { describe, expect, it } from "vitest";

import type { Change } from "../sync/queue";
import type { Project } from "./api";
import type { ProjectCache } from "./store";
import { cacheOwnerToSave, cacheStep, changedFields, initialView, ownershipDecision, planUpdate, withApplied } from "./optimistic";

describe("initialView", () => {
  const cache: ProjectCache = { userId: "a", projects: [{ id: "1", name: "A", description: "", currency: "VND", role: "owner" }], currentProjectId: "1" };
  it("shows nothing of another person's copy, but remembers the owner so it gets cleared", () => {
    expect(initialView(cache, "b")).toEqual({ owner: "a", projects: [], currentProjectId: null });
  });
  it("shows the copy of the same user", () => {
    expect(initialView(cache, "a")).toEqual({ owner: "a", projects: cache.projects, currentProjectId: "1" });
  });
  it("shows the copy while the user id is not known only if the stored signed-in id is its owner", () => {
    expect(initialView(cache, null, "a")).toEqual({ owner: "a", projects: cache.projects, currentProjectId: "1" });
  });
  it("hides the copy while the user id is not known when the stored signed-in id is someone else's", () => {
    expect(initialView(cache, null, "b")).toEqual({ owner: "a", projects: [], currentProjectId: null });
  });
  it("hides the copy while the user id is not known when no signed-in id is stored", () => {
    expect(initialView(cache, null, null)).toEqual({ owner: "a", projects: [], currentProjectId: null });
  });
  it("ignores the stored id once the profile is known", () => {
    expect(initialView(cache, "a", "b")).toEqual({ owner: "a", projects: cache.projects, currentProjectId: "1" });
  });
  it("shows nothing when there is no copy", () => {
    expect(initialView(null, "a")).toEqual({ owner: null, projects: [], currentProjectId: null });
  });
});

describe("cacheStep", () => {
  it("shows nothing and waits when signed out", () => {
    expect(cacheStep({ signedIn: false, cacheOwner: "a", userId: "a", queueCleared: false })).toEqual({
      show: false,
      settleOwnership: false,
      clear: false,
    });
  });
  it("shows the cache at once when signed in but the user id is not known yet", () => {
    expect(cacheStep({ signedIn: true, cacheOwner: "a", userId: null, queueCleared: false })).toEqual({
      show: true,
      settleOwnership: false,
      clear: false,
    });
  });
  it("keeps the cache of the same user once known", () => {
    expect(cacheStep({ signedIn: true, cacheOwner: "a", userId: "a", queueCleared: false })).toEqual({
      show: true,
      settleOwnership: true,
      clear: false,
    });
  });
  it("clears at once when the known user differs from the cache owner", () => {
    expect(cacheStep({ signedIn: true, cacheOwner: "a", userId: "b", queueCleared: false })).toEqual({
      show: false,
      settleOwnership: true,
      clear: true,
    });
  });
  it("clears when the queue dropped another person's changes", () => {
    expect(cacheStep({ signedIn: true, cacheOwner: null, userId: "b", queueCleared: true }).clear).toBe(true);
  });
});

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

describe("cacheOwnerToSave", () => {
  it("never returns an empty owner", () => {
    expect(cacheOwnerToSave(null, null, null)).toBeNull();
    expect(cacheOwnerToSave("", null, "")).toBeNull();
  });
  it("prefers the known owner, then the signed-in user, then the stored id", () => {
    expect(cacheOwnerToSave("a", "b", "c")).toBe("a");
    expect(cacheOwnerToSave(null, "b", "c")).toBe("b");
    expect(cacheOwnerToSave(null, null, "c")).toBe("c");
  });
});
