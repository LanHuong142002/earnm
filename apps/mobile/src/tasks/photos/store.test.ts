import { describe, expect, it, vi } from "vitest";

import type { Change } from "../../sync/queue";
import { createMemoryStore } from "../../sync/storage";
import { PHOTO_ENTITY, PHOTO_UPLOAD_ENTITY } from "../entities";
import {
  clearPhotoCache,
  emptyPhotoCache,
  failedFor,
  loadPhotoCache,
  photosFor,
  prunePhotoCache,
  recordFailed,
  setTaskPhotos,
  subscribePhotos,
  updatePhotoCache,
  withoutFailed,
} from "./store";
import type { ServerPhoto } from "./types";

const photo = (id: string): ServerPhoto => ({
  id,
  taskId: "t1",
  addedBy: null,
  caption: "",
  width: 10,
  height: 10,
  createdAt: "2026-11-01T00:00:00.000Z",
  thumbUrl: "https://cdn/t",
  url: "https://cdn/u",
});

const change = (id: string, projectId = "p1", taskId = "t1", entity = PHOTO_UPLOAD_ENTITY): Change => ({
  changeId: `c-${id}`,
  entity,
  entityId: id,
  kind: "create",
  data: { projectId, taskId },
  fieldTimes: {},
  createdAt: "2026-11-05T00:00:00.000Z",
  attempts: 2,
});

describe("photo cache", () => {
  it("is empty for a new person", async () => {
    expect(await loadPhotoCache(createMemoryStore(), "u1")).toEqual(emptyPhotoCache("u1"));
  });

  it("saves a task's photos under their project and reads them back; null when never fetched", async () => {
    const store = createMemoryStore();
    await updatePhotoCache(store, "u1", (c) => setTaskPhotos(c, "p1", "t1", [photo("a")]));
    const cache = await loadPhotoCache(store, "u1");
    expect(photosFor(cache, "t1")?.map((p) => p.id)).toEqual(["a"]);
    expect(photosFor(cache, "t2")).toBeNull();
  });

  it("is empty for someone else", async () => {
    const store = createMemoryStore();
    await updatePhotoCache(store, "u1", (c) => setTaskPhotos(c, "p1", "t1", [photo("a")]));
    expect((await loadPhotoCache(store, "u2")).byTask).toEqual({});
  });

  it("drops one task's copy when it is malformed and keeps the others", async () => {
    const store = createMemoryStore();
    await store.setJSON("photos.cache.v1", {
      ownerId: "u1",
      byTask: { t1: { projectId: "p1", photos: [photo("a")] }, t2: { projectId: "p1", photos: [{ id: 3 }] } },
      failed: [],
    });
    const cache = await loadPhotoCache(store, "u1");
    expect(Object.keys(cache.byTask)).toEqual(["t1"]);
  });

  it("is cleared on sign-out", async () => {
    const store = createMemoryStore();
    await updatePhotoCache(store, "u1", (c) => setTaskPhotos(c, "p1", "t1", [photo("a")]));
    await clearPhotoCache(store);
    expect((await loadPhotoCache(store, "u1")).byTask).toEqual({});
  });

  it("is pruned with its projects, photos and refused changes both", () => {
    let cache = setTaskPhotos(setTaskPhotos(emptyPhotoCache("u1"), "p1", "t1", [photo("a")]), "p2", "t2", [photo("b")]);
    cache = recordFailed(recordFailed(cache, change("x", "p1")), change("y", "p2"));
    const pruned = prunePhotoCache(cache, ["p2"]);
    expect(Object.keys(pruned.byTask)).toEqual(["t2"]);
    expect(pruned.failed.map((c) => c.entityId)).toEqual(["y"]);
  });
});

describe("refused changes", () => {
  it("keeps one copy of a change without its send count", () => {
    const once = recordFailed(emptyPhotoCache("u1"), change("a"));
    const twice = recordFailed(once, change("a"));
    expect(twice.failed).toHaveLength(1);
    expect(twice.failed[0].attempts).toBeUndefined();
  });

  it("filters by task and removes by a test", () => {
    const cache = recordFailed(recordFailed(emptyPhotoCache("u1"), change("a")), change("b", "p1", "t2", PHOTO_ENTITY));
    expect(failedFor(cache, "t2").map((c) => c.entityId)).toEqual(["b"]);
    expect(withoutFailed(cache, (c) => c.entityId === "a").failed.map((c) => c.entityId)).toEqual(["b"]);
  });

  it("survives a reload, and a refused change of another kind of entity is not trusted", async () => {
    const store = createMemoryStore();
    await updatePhotoCache(store, "u1", (c) => recordFailed(c, change("a")));
    const stored = (await store.getJSON<{ failed: unknown[] }>("photos.cache.v1"))!;
    await store.setJSON("photos.cache.v1", { ...stored, failed: [...stored.failed, { ...change("z"), entity: "comment" }] });
    expect((await loadPhotoCache(store, "u1")).failed.map((c) => c.entityId)).toEqual(["a"]);
  });
});

describe("writes", () => {
  it("run one after another and tell the listeners", async () => {
    const store = createMemoryStore();
    const seen = vi.fn();
    const off = subscribePhotos(seen);
    await Promise.all([
      updatePhotoCache(store, "u1", (c) => setTaskPhotos(c, "p1", "t1", [photo("a")])),
      updatePhotoCache(store, "u1", (c) => setTaskPhotos(c, "p1", "t2", [photo("b")])),
    ]);
    off();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(Object.keys((await loadPhotoCache(store, "u1")).byTask).sort()).toEqual(["t1", "t2"]);
  });
});
