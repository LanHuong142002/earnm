import { describe, expect, it, vi } from "vitest";

import type { Change } from "../../sync/queue";
import { createMemoryStore } from "../../sync/storage";
import {
  clearCommentCache,
  commentsFor,
  emptyCommentCache,
  failedFor,
  loadCommentCache,
  loadSortOrder,
  pruneCommentCache,
  recordFailed,
  saveSortOrder,
  setTaskComments,
  subscribeComments,
  updateCommentCache,
  withoutFailed,
} from "./store";
import type { ServerComment } from "./types";

const comment = (id: string, over: Partial<ServerComment> = {}): ServerComment => ({
  id,
  taskId: "t1",
  author: { id: "u1", displayName: "Lan" },
  text: id,
  edited: false,
  remindWith: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

const failedChange = (changeId: string, entityId: string, taskId = "t1"): Change => ({
  changeId,
  entity: "comment",
  entityId,
  kind: "update",
  data: { projectId: "p1", taskId, text: "x" },
  fieldTimes: { text: "2026-11-02T00:00:00.000Z" },
  createdAt: "2026-11-02T00:00:00.000Z",
  attempts: 2,
});

describe("comment cache", () => {
  it("keeps each task's comments per owner and reads them back after a reload", async () => {
    const store = createMemoryStore();
    await updateCommentCache(store, "me", (c) => setTaskComments(c, "p1", "t1", [comment("a")]));
    const reloaded = await loadCommentCache(store, "me");
    expect(commentsFor(reloaded, "t1")).toEqual([comment("a")]);
    expect(commentsFor(reloaded, "t2")).toBeNull();
  });

  it("never shows another owner's comments", async () => {
    const store = createMemoryStore();
    await updateCommentCache(store, "me", (c) => setTaskComments(c, "p1", "t1", [comment("a")]));
    expect(commentsFor(await loadCommentCache(store, "someone-else"), "t1")).toBeNull();
    // Writing as the new owner replaces what the old one left.
    await updateCommentCache(store, "someone-else", (c) => setTaskComments(c, "p1", "t9", [comment("z", { taskId: "t9" })]));
    expect(commentsFor(await loadCommentCache(store, "someone-else"), "t1")).toBeNull();
  });

  it("drops a task's cached list that is malformed instead of trusting it", async () => {
    const store = createMemoryStore();
    await store.setJSON("comments.cache.v1", {
      ownerId: "me",
      byTask: { t1: { projectId: "p1", comments: [{ id: "a" }] }, t2: { projectId: "p1", comments: [comment("b", { taskId: "t2" })] } },
      failed: [],
    });
    const cache = await loadCommentCache(store, "me");
    expect(commentsFor(cache, "t1")).toBeNull();
    expect(commentsFor(cache, "t2")).toHaveLength(1);
  });

  it("serialises updates so two writers never lose each other's change", async () => {
    const store = createMemoryStore();
    await Promise.all([
      updateCommentCache(store, "me", (c) => setTaskComments(c, "p1", "t1", [comment("a")])),
      updateCommentCache(store, "me", (c) => setTaskComments(c, "p1", "t2", [comment("b", { taskId: "t2" })])),
      updateCommentCache(store, "me", (c) => recordFailed(c, failedChange("f1", "a"))),
    ]);
    const cache = await loadCommentCache(store, "me");
    expect(commentsFor(cache, "t1")).toHaveLength(1);
    expect(commentsFor(cache, "t2")).toHaveLength(1);
    expect(cache.failed).toHaveLength(1);
  });

  it("tells listeners after a write", async () => {
    const store = createMemoryStore();
    const listener = vi.fn();
    const off = subscribeComments(listener);
    await updateCommentCache(store, "me", (c) => c);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    await updateCommentCache(store, "me", (c) => c);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("failed changes", () => {
  it("are recorded without their send count, once per change", () => {
    let cache = emptyCommentCache("me");
    cache = recordFailed(cache, failedChange("f1", "a"));
    cache = recordFailed(cache, failedChange("f1", "a"));
    expect(cache.failed).toHaveLength(1);
    expect(cache.failed[0]!.attempts).toBeUndefined();
  });

  it("are listed per task and removed by comment", () => {
    let cache = emptyCommentCache("me");
    cache = recordFailed(cache, failedChange("f1", "a"));
    cache = recordFailed(cache, failedChange("f2", "a"));
    cache = recordFailed(cache, failedChange("f3", "b"));
    cache = recordFailed(cache, failedChange("f4", "c", "t2"));
    expect(failedFor(cache, "t1").map((c) => c.changeId)).toEqual(["f1", "f2", "f3"]);
    const left = withoutFailed(cache, (c) => c.entityId === "a");
    expect(left.failed.map((c) => c.changeId)).toEqual(["f3", "f4"]);
  });
});

describe("pruning", () => {
  it("drops the comments and failed changes of projects that are gone", () => {
    let cache = emptyCommentCache("me");
    cache = setTaskComments(cache, "p1", "t1", [comment("a")]);
    cache = setTaskComments(cache, "p2", "t2", [comment("b", { taskId: "t2" })]);
    cache = recordFailed(cache, { ...failedChange("f1", "a"), data: { projectId: "p2", taskId: "t2", text: "x" } });
    const pruned = pruneCommentCache(cache, ["p1"]);
    expect(Object.keys(pruned.byTask)).toEqual(["t1"]);
    expect(pruned.failed).toEqual([]);
  });

  it("clearing removes everything", async () => {
    const store = createMemoryStore();
    await updateCommentCache(store, "me", (c) => setTaskComments(c, "p1", "t1", [comment("a")]));
    await clearCommentCache(store);
    expect(commentsFor(await loadCommentCache(store, "me"), "t1")).toBeNull();
  });
});

describe("sort preference", () => {
  it("defaults to newest and remembers the choice on the device", async () => {
    const store = createMemoryStore();
    expect(await loadSortOrder(store)).toBe("newest");
    await saveSortOrder(store, "oldest");
    expect(await loadSortOrder(store)).toBe("oldest");
  });
  it("ignores a saved value it does not know", async () => {
    const store = createMemoryStore();
    await store.setJSON("comments.sort.v1", "sideways");
    expect(await loadSortOrder(store)).toBe("newest");
  });
});
