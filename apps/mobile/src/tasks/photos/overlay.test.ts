import { describe, expect, it } from "vitest";

import type { Change } from "../../sync/queue";
import { PHOTO_ENTITY, PHOTO_UPLOAD_ENTITY } from "../entities";
import { applyPhotoOverlay, staleFailedIds } from "./overlay";
import type { ServerPhoto } from "./types";

const server = (id: string, over: Partial<ServerPhoto> = {}): ServerPhoto => ({
  id,
  taskId: "t1",
  addedBy: { id: "u1", displayName: "Lan" },
  caption: "",
  width: 100,
  height: 80,
  createdAt: "2026-11-01T00:00:00.000Z",
  thumbUrl: `https://cdn/thumb-${id}`,
  url: `https://cdn/${id}`,
  ...over,
});

let n = 0;
const change = (entity: string, kind: Change["kind"], id: string, data: Record<string, unknown> = {}, taskId = "t1"): Change => ({
  changeId: `c${++n}`,
  entity,
  entityId: id,
  kind,
  data: { projectId: "p1", taskId, ...data },
  fieldTimes: {},
  createdAt: "2026-11-05T00:00:00.000Z",
});

const upload = (id: string, data: Record<string, unknown> = {}) =>
  change(PHOTO_UPLOAD_ENTITY, "create", id, { width: 1600, height: 1200, authorId: "u1", authorName: "Lan", ...data });

const opts = (uploading: string[] = []) => ({ uploading: new Set(uploading), localUri: (id: string) => `file:///docs/pending-photos/${id}.jpg` });

describe("applyPhotoOverlay", () => {
  it("marks the server's photos synced with nothing queued", () => {
    const list = applyPhotoOverlay("t1", [server("a")], [], [], opts());
    expect(list).toEqual([{ ...server("a"), state: "synced", edit: "none" }]);
  });

  it("shows a queued upload at once as waiting, with the file on the phone as its picture", () => {
    const list = applyPhotoOverlay("t1", [], [upload("n1")], [], opts());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "n1",
      state: "waiting",
      edit: "none",
      thumbUrl: "file:///docs/pending-photos/n1.jpg",
      url: "file:///docs/pending-photos/n1.jpg",
      width: 1600,
      height: 1200,
      addedBy: { id: "u1", displayName: "Lan" },
      createdAt: "2026-11-05T00:00:00.000Z",
    });
  });

  it("shows the upload that is being sent as uploading", () => {
    const list = applyPhotoOverlay("t1", [], [upload("n1"), upload("n2")], [], opts(["n2"]));
    expect(list.map((p) => [p.id, p.state])).toEqual([
      ["n1", "waiting"],
      ["n2", "uploading"],
    ]);
  });

  it("shows a refused upload as failed", () => {
    const list = applyPhotoOverlay("t1", [], [], [upload("n1")], opts());
    expect(list[0]).toMatchObject({ id: "n1", state: "failed" });
  });

  it("does not add the upload again once the server has the photo", () => {
    const list = applyPhotoOverlay("t1", [server("a")], [upload("a")], [], opts());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ state: "synced", thumbUrl: "https://cdn/thumb-a" });
  });

  it("shows a waiting caption change at once and marks the edit as waiting", () => {
    const list = applyPhotoOverlay("t1", [server("a")], [change(PHOTO_ENTITY, "update", "a", { caption: "Hoá đơn" })], [], opts());
    expect(list[0]).toMatchObject({ caption: "Hoá đơn", state: "synced", edit: "waiting" });
  });

  it("a caption cleared offline shows as empty", () => {
    const list = applyPhotoOverlay("t1", [server("a", { caption: "cũ" })], [change(PHOTO_ENTITY, "update", "a", { caption: "" })], [], opts());
    expect(list[0].caption).toBe("");
  });

  it("hides a photo whose delete is waiting", () => {
    const list = applyPhotoOverlay("t1", [server("a"), server("b")], [change(PHOTO_ENTITY, "delete", "a")], [], opts());
    expect(list.map((p) => p.id)).toEqual(["b"]);
  });

  it("keeps a photo whose delete was refused, marked failed", () => {
    const list = applyPhotoOverlay("t1", [server("a")], [], [change(PHOTO_ENTITY, "delete", "a")], opts());
    expect(list[0]).toMatchObject({ id: "a", edit: "failed", state: "synced" });
  });

  it("shows failed when a photo has both a refused and a waiting change", () => {
    const list = applyPhotoOverlay(
      "t1",
      [server("a")],
      [change(PHOTO_ENTITY, "update", "a", { caption: "mới" })],
      [change(PHOTO_ENTITY, "update", "a", { caption: "cũ" })],
      opts(),
    );
    expect(list[0]).toMatchObject({ edit: "failed", caption: "mới" });
  });

  it("ignores changes for another task and for a photo that is not there", () => {
    const list = applyPhotoOverlay(
      "t1",
      [server("a")],
      [upload("x", {}), change(PHOTO_ENTITY, "update", "zzz", { caption: "?" }), { ...upload("o"), data: { projectId: "p1", taskId: "t2" } }],
      [],
      opts(),
    );
    expect(list.map((p) => p.id)).toEqual(["a", "x"]);
  });

  it("uses an empty name for a waiting photo whose author name was not saved", () => {
    const list = applyPhotoOverlay("t1", [], [upload("n1", { authorName: undefined })], [], opts());
    expect(list[0].addedBy).toEqual({ id: "u1", displayName: "" });
  });
});

describe("staleFailedIds", () => {
  it("drops a refused caption change or delete for a photo gone from the server", () => {
    const failed = [change(PHOTO_ENTITY, "update", "gone", { caption: "x" }), change(PHOTO_ENTITY, "delete", "there")];
    expect(staleFailedIds("t1", [server("there")], failed)).toEqual([failed[0].changeId]);
  });

  it("never drops a refused upload, which no server list can contain", () => {
    expect(staleFailedIds("t1", [], [upload("n1")])).toEqual([]);
  });

  it("keeps a refused caption change on a photo whose upload also failed", () => {
    const failed = [upload("n1"), change(PHOTO_ENTITY, "update", "n1", { caption: "x" })];
    expect(staleFailedIds("t1", [], failed)).toEqual([]);
  });
});
