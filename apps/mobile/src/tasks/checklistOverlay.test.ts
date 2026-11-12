import { describe, expect, it } from "vitest";

import type { Change } from "../sync/queue";
import { createMemoryStore } from "../sync/storage";
import { makeTask } from "./fixtures";
import {
  applyLabelOverlay,
  applyTaskOverlay,
  emptyTaskCache,
  loadTaskCache,
  openTaskCache,
  pruneTaskCache,
  saveTaskCache,
  setProjectLabels,
} from "./store";
import type { Checklist, Label } from "./types";

const T1 = "2026-11-10T10:00:00.000Z";

function change(entity: string, kind: Change["kind"], entityId: string, data: Record<string, unknown>): Change {
  return { changeId: `c-${entity}-${kind}-${entityId}`, entity, entityId, kind, data: { projectId: "p1", ...data }, fieldTimes: {}, createdAt: T1 };
}

const checklist = (over: Partial<Checklist> = {}): Checklist => ({
  id: "c1",
  name: "Shopping",
  createdAt: T1,
  items: [{ id: "i1", text: "Paint", done: false, createdAt: T1 }],
  ...over,
});

describe("applyTaskOverlay with checklists and items (AC14)", () => {
  const server = [makeTask({ checklists: [checklist()] })];

  it("keeps a waiting tick over a stale refresh", () => {
    const waiting = [change("checklistItem", "update", "i1", { taskId: "t1", checklistId: "c1", done: true })];
    expect(applyTaskOverlay("p1", server, waiting)[0].checklists[0].items[0]).toMatchObject({ text: "Paint", done: true });
  });

  it("shows a waiting checklist create, with an item added to it", () => {
    const waiting = [
      change("checklist", "create", "c2", { taskId: "t1", name: "Tools" }),
      change("checklistItem", "create", "i2", { taskId: "t1", checklistId: "c2", text: "Brush", done: false }),
    ];
    const lists = applyTaskOverlay("p1", server, waiting)[0].checklists;
    expect(lists.map((c) => c.name)).toEqual(["Shopping", "Tools"]);
    expect(lists[1].items).toMatchObject([{ id: "i2", text: "Brush", done: false }]);
  });

  it("a waiting checklist rename and item delete hide the old values", () => {
    const waiting = [
      change("checklist", "update", "c1", { taskId: "t1", name: "Buy" }),
      change("checklistItem", "delete", "i1", { taskId: "t1", checklistId: "c1" }),
    ];
    const result = applyTaskOverlay("p1", server, waiting)[0].checklists[0];
    expect(result.name).toBe("Buy");
    expect(result.items).toEqual([]);
  });

  it("a waiting checklist delete hides it", () => {
    const waiting = [change("checklist", "delete", "c1", { taskId: "t1" })];
    expect(applyTaskOverlay("p1", server, waiting)[0].checklists).toEqual([]);
  });

  it("ignores changes for a checklist or task the server no longer has", () => {
    const waiting = [
      change("checklistItem", "update", "i1", { taskId: "t1", checklistId: "gone", done: true }),
      change("checklist", "create", "c9", { taskId: "missing", name: "x" }),
    ];
    expect(applyTaskOverlay("p1", server, waiting)).toEqual(server);
  });

  it("a checklist created on a task that was itself created offline shows", () => {
    const waiting = [
      { ...change("task", "create", "n1", { title: "New" }) },
      change("checklist", "create", "c5", { taskId: "n1", name: "Steps" }),
    ];
    const created = applyTaskOverlay("p1", [], waiting)[0];
    expect(created.checklists.map((c) => c.name)).toEqual(["Steps"]);
  });

  it("task labels from a waiting update replace the server set, and a waiting label delete takes the label off", () => {
    const tasks = [makeTask({ labelIds: ["a", "b"] }), makeTask({ id: "t2", labelIds: ["a"] })];
    const set = [change("task", "update", "t1", { labels: ["b", "c"] })];
    expect(applyTaskOverlay("p1", tasks, set)[0].labelIds).toEqual(["b", "c"]);
    const del = [change("label", "delete", "a", {})];
    expect(applyTaskOverlay("p1", tasks, del).map((t) => t.labelIds)).toEqual([["b"], []]);
  });
});

describe("applyLabelOverlay", () => {
  const server: Label[] = [{ id: "a", name: "Urgent", colour: "red" }];

  it("shows a waiting create, rename and delete", () => {
    const waiting = [
      change("label", "create", "b", { name: "Later", colour: "blue" }),
      change("label", "update", "a", { name: "Now" }),
    ];
    expect(applyLabelOverlay("p1", server, waiting)).toMatchObject([
      { id: "a", name: "Now", colour: "red" },
      { id: "b", name: "Later", colour: "blue" },
    ]);
    expect(applyLabelOverlay("p1", server, [change("label", "delete", "a", {})])).toEqual([]);
  });

  it("ignores another project's label changes", () => {
    const other = { ...change("label", "create", "b", { name: "x", colour: "blue" }), data: { projectId: "p2", name: "x", colour: "blue" } };
    expect(applyLabelOverlay("p1", server, [other])).toEqual(server);
  });
});

describe("the task cache with labels", () => {
  it("still reads a copy saved before labels and checklists existed (cache key stays v1)", async () => {
    const store = createMemoryStore();
    const { labelIds: _l, checklists: _c, ...old } = makeTask();
    await store.setJSON("tasks.cache.v1", {
      ownerId: "u1",
      byProject: { p1: [old] },
      filters: { p1: { status: "all", mine: false, dueSoon: false } },
    });
    const cache = await loadTaskCache(store, "u1");
    expect(cache?.byProject.p1[0]).toMatchObject({ labelIds: [], checklists: [] });
    expect(cache?.labelsByProject).toEqual({});
  });

  it("round-trips labels and prunes them with the project", async () => {
    const store = createMemoryStore();
    let cache = setProjectLabels(emptyTaskCache("u1"), "p1", [{ id: "a", name: "Urgent", colour: "red" }]);
    cache = setProjectLabels(cache, "p2", [{ id: "b", name: "Later", colour: "blue" }]);
    await saveTaskCache(store, cache);
    const loaded = await loadTaskCache(store, "u1");
    expect(loaded?.labelsByProject.p1[0].name).toBe("Urgent");
    expect(Object.keys(pruneTaskCache(loaded!, ["p1"]).labelsByProject)).toEqual(["p1"]);
  });

  it("another person's copy, labels included, is removed and not shown (owner check)", async () => {
    const store = createMemoryStore();
    await saveTaskCache(store, setProjectLabels(emptyTaskCache("u1"), "p1", [{ id: "a", name: "Urgent", colour: "red" }]));
    expect(await loadTaskCache(store, "u2")).toBeNull();
    const opened = await openTaskCache(store, "u2", false);
    expect(opened).toEqual(emptyTaskCache("u2"));
    expect(await loadTaskCache(store, "u1")).toBeNull();
  });

  it("a copy with a malformed label list is not trusted", async () => {
    const store = createMemoryStore();
    await store.setJSON("tasks.cache.v1", { ownerId: "u1", byProject: {}, filters: {}, labelsByProject: { p1: [{ id: 1 }] } });
    expect(await loadTaskCache(store, "u1")).toBeNull();
  });
});
