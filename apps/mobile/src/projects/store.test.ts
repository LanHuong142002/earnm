import { describe, expect, it } from "vitest";

import type { Change } from "../sync/queue";
import { createMemoryStore } from "../sync/storage";
import type { Project } from "./api";
import {
  applyOverlay,
  clearProjectCache,
  loadProjectCache,
  saveProjectCache,
  validateProjectInput,
} from "./store";

const T = "2026-01-01T00:00:00.000Z";
const A: Project = { id: "a", name: "Alpha", description: "", currency: "VND", role: "owner" };
const B: Project = { id: "b", name: "Beta", description: "d", currency: "USD", role: "member" };

function change(p: Partial<Change> & Pick<Change, "kind" | "entityId">): Change {
  return {
    changeId: `${p.kind}-${p.entityId}`,
    entity: "project",
    data: {},
    fieldTimes: {},
    createdAt: T,
    ...p,
  };
}

describe("applyOverlay", () => {
  it("keeps a waiting rename when the refresh still has the old name", () => {
    const out = applyOverlay([A, B], [change({ kind: "update", entityId: "a", data: { name: "Renamed" } })]);
    expect(out.find((p) => p.id === "a")?.name).toBe("Renamed");
    expect(out.find((p) => p.id === "b")).toEqual(B);
  });

  it("a project missing from the server list is gone", () => {
    expect(applyOverlay([A], [])).toEqual([A]);
  });

  it("shows a waiting create as owner, after the server projects", () => {
    const out = applyOverlay(
      [A],
      [change({ kind: "create", entityId: "n", data: { name: "New", description: "x", currency: "USD" } })],
    );
    expect(out).toEqual([A, { id: "n", name: "New", description: "x", currency: "USD", role: "owner" }]);
  });

  it("applies create data onto a project the server already has", () => {
    const out = applyOverlay([A], [change({ kind: "create", entityId: "a", data: { name: "Again" } })]);
    expect(out).toEqual([{ ...A, name: "Again" }]);
  });

  it("hides a waiting delete", () => {
    expect(applyOverlay([A, B], [change({ kind: "delete", entityId: "a" })])).toEqual([B]);
  });

  it("ignores an update for a project that is not present", () => {
    expect(applyOverlay([A], [change({ kind: "update", entityId: "zzz", data: { name: "x" } })])).toEqual([A]);
  });

  it("ignores changes for other entities and does not mutate input", () => {
    const list = [A];
    const out = applyOverlay(list, [change({ kind: "delete", entityId: "a", entity: "expense" })]);
    expect(out).toEqual([A]);
    applyOverlay(list, [change({ kind: "update", entityId: "a", data: { name: "Z" } })]);
    expect(list[0].name).toBe("Alpha");
  });

  it("applies changes in order", () => {
    const out = applyOverlay(
      [],
      [
        change({ kind: "create", entityId: "n", data: { name: "N", currency: "VND" } }),
        change({ kind: "update", entityId: "n", data: { name: "N2" } }),
      ],
    );
    expect(out.map((p) => p.name)).toEqual(["N2"]);
  });
});

describe("validateProjectInput", () => {
  const ok = { name: "x", description: "", currency: "VND" };

  it("trims and accepts valid input", () => {
    expect(validateProjectInput({ name: "  Home ", description: " d ", currency: "USD" })).toEqual({
      ok: true,
      value: { name: "Home", description: "d", currency: "USD" },
    });
  });

  it("name limits after trim", () => {
    expect(validateProjectInput({ ...ok, name: "   " })).toEqual({ ok: false, errors: { name: "required" } });
    expect(validateProjectInput({ ...ok, name: "a" }).ok).toBe(true);
    expect(validateProjectInput({ ...ok, name: ` ${"a".repeat(80)} ` }).ok).toBe(true);
    expect(validateProjectInput({ ...ok, name: "a".repeat(81) })).toEqual({
      ok: false,
      errors: { name: "too_long" },
    });
  });

  it("description limits", () => {
    expect(validateProjectInput({ ...ok, description: "a".repeat(500) }).ok).toBe(true);
    expect(validateProjectInput({ ...ok, description: "a".repeat(501) })).toEqual({
      ok: false,
      errors: { description: "too_long" },
    });
  });

  it("rejects a bad currency and reports all errors", () => {
    expect(validateProjectInput({ name: "", description: "a".repeat(501), currency: "EUR" })).toEqual({
      ok: false,
      errors: { name: "required", description: "too_long", currency: "invalid" },
    });
  });
});

describe("project cache", () => {
  it("round-trips and clears", async () => {
    const store = createMemoryStore();
    const cache = { userId: "u1", projects: [A, B], currentProjectId: "b" };
    await saveProjectCache(store, cache);
    expect(await loadProjectCache(store)).toEqual(cache);
    await clearProjectCache(store);
    expect(await loadProjectCache(store)).toBeNull();
  });

  it("returns null for malformed data", async () => {
    const store = createMemoryStore();
    await store.setJSON("projects.cache.v1", { userId: 5, projects: "nope" });
    expect(await loadProjectCache(store)).toBeNull();
    await store.setJSON("projects.cache.v1", { userId: "u", projects: [{ id: 1 }], currentProjectId: null });
    expect(await loadProjectCache(store)).toBeNull();
  });
});
