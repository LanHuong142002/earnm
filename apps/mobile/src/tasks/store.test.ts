import { describe, expect, it } from "vitest";

import type { Change } from "../sync/queue";
import { createMemoryStore } from "../sync/storage";
import { makeTask } from "./fixtures";
import {
  applyTaskOverlay,
  clearTaskCache,
  emptyTaskCache,
  loadTaskCache,
  openTaskCache,
  pruneTaskCache,
  saveTaskCache,
  setProjectFilters,
  setProjectTasks,
} from "./store";

const T1 = "2026-11-10T10:00:00.000Z";

function change(over: Partial<Change> & Pick<Change, "kind" | "entityId">): Change {
  return {
    changeId: `c-${over.kind}-${over.entityId}`,
    entity: "task",
    data: { projectId: "p1" },
    fieldTimes: {},
    createdAt: T1,
    ...over,
  };
}

describe("applyTaskOverlay (AC14)", () => {
  it("keeps a waiting rename over a stale refresh", () => {
    const server = [makeTask({ title: "Old" })];
    const waiting = [change({ kind: "update", entityId: "t1", data: { projectId: "p1", title: "New" } })];
    expect(applyTaskOverlay("p1", server, waiting)[0].title).toBe("New");
  });

  it("drops a task the server no longer has, and ignores a waiting update for it", () => {
    const result = applyTaskOverlay("p1", [makeTask({ id: "a" })], [
      change({ kind: "update", entityId: "b", data: { projectId: "p1", title: "x" } }),
    ]);
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });

  it("updates status, due and assignees from a waiting update", () => {
    const server = [makeTask({ assignees: [{ id: "u1", displayName: "Lan" }] })];
    const waiting = [
      change({
        kind: "update",
        entityId: "t1",
        data: {
          projectId: "p1",
          status: "done",
          due: { date: "2026-11-14", time: "14:30" },
          assignees: ["u1", "u2"],
          assigneeNames: { u1: "Lan", u2: "Huy" },
        },
      }),
    ];
    const t = applyTaskOverlay("p1", server, waiting)[0];
    expect(t.status).toBe("done");
    expect(t.dueDate).toBe("2026-11-14");
    expect(t.dueTime).toBe("14:30");
    expect(t.assignees).toEqual([
      { id: "u1", displayName: "Lan" },
      { id: "u2", displayName: "Huy" },
    ]);
  });

  it("clears the due date when the waiting update sets due to null", () => {
    const server = [makeTask({ dueDate: "2026-11-14", dueTime: "09:00" })];
    const waiting = [change({ kind: "update", entityId: "t1", data: { projectId: "p1", due: null } })];
    const t = applyTaskOverlay("p1", server, waiting)[0];
    expect(t.dueDate).toBeNull();
    expect(t.dueTime).toBeNull();
  });

  it("removes a task with a waiting delete", () => {
    const waiting = [change({ kind: "delete", entityId: "t1" })];
    expect(applyTaskOverlay("p1", [makeTask()], waiting)).toEqual([]);
  });

  it("adds a task created offline after the server's tasks", () => {
    const waiting = [
      change({
        kind: "create",
        entityId: "new",
        data: {
          projectId: "p1",
          title: "Offline",
          description: "",
          status: "todo",
          due: null,
          assignees: [],
          createdById: "u1",
        },
      }),
    ];
    const list = applyTaskOverlay("p1", [makeTask({ id: "a" })], waiting);
    expect(list.map((t) => t.id)).toEqual(["a", "new"]);
    expect(list[1]).toMatchObject({ title: "Offline", projectId: "p1", createdById: "u1", createdAt: T1, status: "todo" });
  });

  it("ignores changes for another project and for another entity", () => {
    const waiting = [
      change({ kind: "delete", entityId: "t1", data: { projectId: "p2" } }),
      change({ kind: "delete", entityId: "t1", entity: "project" }),
    ];
    expect(applyTaskOverlay("p1", [makeTask()], waiting)).toHaveLength(1);
  });
});

describe("task cache", () => {
  it("round-trips through the store", async () => {
    const store = createMemoryStore();
    const cache = setProjectTasks(emptyTaskCache("u1"), "p1", [makeTask()]);
    await saveTaskCache(store, cache);
    expect(await loadTaskCache(store, "u1")).toEqual(cache);
  });

  it("loads nothing when the owner is someone else (owner check)", async () => {
    const store = createMemoryStore();
    await saveTaskCache(store, setProjectTasks(emptyTaskCache("u1"), "p1", [makeTask()]));
    expect(await loadTaskCache(store, "u2")).toBeNull();
  });

  it("loads nothing for malformed data", async () => {
    const store = createMemoryStore();
    await store.setJSON("tasks.cache.v1", { ownerId: "u1", byProject: { p1: [{ id: 5 }] }, filters: {} });
    expect(await loadTaskCache(store, "u1")).toBeNull();
    await store.setJSON("tasks.cache.v1", "nope");
    expect(await loadTaskCache(store, "u1")).toBeNull();
  });

  it("filters saved before onlyMe existed load with onlyMe off", async () => {
    const store = createMemoryStore();
    await store.setJSON("tasks.cache.v1", {
      ownerId: "u1",
      byProject: {},
      filters: { p1: { status: "doing", mine: true, dueSoon: true } },
    });
    const loaded = await loadTaskCache(store, "u1");
    expect(loaded?.filters.p1).toEqual({ status: "doing", mine: true, onlyMe: false, dueSoon: true });
  });

  it("clear removes it", async () => {
    const store = createMemoryStore();
    await saveTaskCache(store, emptyTaskCache("u1"));
    await clearTaskCache(store);
    expect(await loadTaskCache(store, "u1")).toBeNull();
  });
});

describe("openTaskCache: the decision is acted on, not just returned", () => {
  const filled = () =>
    setProjectFilters(setProjectTasks(emptyTaskCache("u1"), "p1", [makeTask()]), "p1", {
      status: "done",
      mine: true,
      onlyMe: false,
      dueSoon: false,
    });

  it("returns the saved copy for the same owner", async () => {
    const store = createMemoryStore();
    await saveTaskCache(store, filled());
    expect(await openTaskCache(store, "u1", false)).toEqual(filled());
  });

  it("another owner: returns an empty copy for the signed-in user AND removes the stored tasks and filters", async () => {
    const store = createMemoryStore();
    await saveTaskCache(store, filled());
    const opened = await openTaskCache(store, "u2", false);
    expect(opened).toEqual(emptyTaskCache("u2"));
    expect(await store.getJSON("tasks.cache.v1")).toBeNull();
  });

  it("the queue dropped another person's changes: the copy is cleared even for the same owner", async () => {
    const store = createMemoryStore();
    await saveTaskCache(store, filled());
    expect(await openTaskCache(store, "u1", true)).toEqual(emptyTaskCache("u1"));
    expect(await store.getJSON("tasks.cache.v1")).toBeNull();
  });

  it("nothing stored: an empty copy for the user", async () => {
    expect(await openTaskCache(createMemoryStore(), "u1", false)).toEqual(emptyTaskCache("u1"));
  });
});

describe("cache helpers", () => {
  it("setProjectTasks and setProjectFilters do not change their input", () => {
    const base = emptyTaskCache("u1");
    setProjectTasks(base, "p1", [makeTask()]);
    setProjectFilters(base, "p1", { status: "all", mine: false, onlyMe: false, dueSoon: true });
    expect(base).toEqual(emptyTaskCache("u1"));
  });

  it("pruneTaskCache drops tasks and filters of projects that are gone", () => {
    let cache = emptyTaskCache("u1");
    cache = setProjectTasks(cache, "p1", [makeTask()]);
    cache = setProjectTasks(cache, "p2", [makeTask({ id: "x", projectId: "p2" })]);
    cache = setProjectFilters(cache, "p2", { status: "all", mine: true, onlyMe: false, dueSoon: false });
    const pruned = pruneTaskCache(cache, ["p1"]);
    expect(Object.keys(pruned.byProject)).toEqual(["p1"]);
    expect(pruned.filters).toEqual({});
  });
});

describe("members are not kept in the task cache (R27)", () => {
  it("loads an older copy that still has membersByProject, ignoring the field", async () => {
    const store = createMemoryStore();
    await store.setJSON("tasks.cache.v1", {
      ownerId: "u1",
      byProject: { p1: [makeTask()] },
      filters: {},
      membersByProject: { p1: [{ id: "u1", displayName: "An" }] },
    });
    const loaded = await loadTaskCache(store, "u1");
    expect(loaded?.byProject.p1).toHaveLength(1);
    expect(loaded).not.toHaveProperty("membersByProject");
  });

  it("does not write members back", async () => {
    const store = createMemoryStore();
    await store.setJSON("tasks.cache.v1", { ownerId: "u1", byProject: {}, filters: {}, membersByProject: { p1: [] } });
    const loaded = await loadTaskCache(store, "u1");
    await saveTaskCache(store, loaded!);
    expect(await store.getJSON("tasks.cache.v1")).not.toHaveProperty("membersByProject");
  });
});
