import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";
import { createQueue, type Change } from "../../sync/queue";
import { createMemoryStore, type KeyValueStore } from "../../sync/storage";
import { PHOTO_ENTITY, PHOTO_UPLOAD_ENTITY } from "../entities";
import { loadPhotoCache } from "./store";
import {
  cancelUpload,
  discardFailed,
  photoCaptionChange,
  photoDeleteChange,
  photoUploadChange,
  registerPhotoEntities,
  retryFailed,
  settleFailures,
  uploadingIds,
  type PhotoDeps,
} from "./uploads";
import type { ServerPhoto, UploadSignature } from "./types";

const NOW = new Date("2026-11-17T09:00:00.000Z");
const ctx = { projectId: "p1", taskId: "t1" };
const ID = "5b1f3c1e-0000-4000-8000-000000000001";

const signature: UploadSignature = {
  cloudName: "demo",
  apiKey: "key123",
  timestamp: 1_700_000_000,
  signature: "sig456",
  publicId: `earnm/p1/t1/${ID}`,
  type: "authenticated",
};

const saved = (id: string): ServerPhoto => ({
  id,
  taskId: "t1",
  addedBy: null,
  caption: "",
  width: 1600,
  height: 1200,
  createdAt: NOW.toISOString(),
  thumbUrl: "https://cdn/t",
  url: "https://cdn/u",
});

const reply = (status: number) => ({ ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => "" }) as unknown as Response;

function setup(opts: { store?: KeyValueStore; deps?: Partial<PhotoDeps>; fileExists?: boolean } = {}) {
  const store = opts.store ?? createMemoryStore();
  const removed: string[] = [];
  const existing = new Set<string>(opts.fileExists === false ? [] : [ID]);
  const calls: string[] = [];
  const deps: PhotoDeps = {
    signPhoto: vi.fn(async () => {
      calls.push("sign");
      return signature;
    }),
    recordPhoto: vi.fn(async (_t: string, _p: string, _task: string, body: { id: string }) => {
      calls.push("record");
      return saved(body.id);
    }),
    patchPhotoCaption: vi.fn(async (_t: string, _p: string, _task: string, id: string) => saved(id)),
    deletePhoto: vi.fn(async () => undefined),
    fetch: vi.fn(async () => {
      calls.push("upload");
      return reply(200);
    }) as unknown as typeof fetch,
    files: {
      uriFor: (id) => `file:///docs/pending-photos/${id}.jpg`,
      exists: (id) => existing.has(id),
      remove: (id) => {
        existing.delete(id);
        removed.push(id);
      },
    },
    ...opts.deps,
  };
  const applied: Change[] = [];
  const rejected: Change[] = [];
  const queue = createQueue({
    store,
    getToken: async () => "tok",
    onApplied: (c) => void applied.push(c),
    onRejected: (c) => void rejected.push(c),
    onSignedOut: () => {},
  });
  registerPhotoEntities(queue, store, deps);
  return { store, queue, deps, removed, existing, calls, applied, rejected };
}

const upload = (id = ID, extra: Partial<Parameters<typeof photoUploadChange>[0]> = {}) =>
  photoUploadChange({ ...ctx, id, width: 1600, height: 1200, author: { id: "u1", displayName: "Lan" }, now: NOW, ...extra });

describe("queued photo changes", () => {
  it("an upload keeps only what is needed to resume it: ids, size, author, never a file path or a secret", () => {
    const c = upload();
    expect(c).toMatchObject({ entity: PHOTO_UPLOAD_ENTITY, entityId: ID, kind: "create" });
    expect(c.data).toEqual({ projectId: "p1", taskId: "t1", width: 1600, height: 1200, authorId: "u1", authorName: "Lan" });
  });

  it("a caption change carries its own time, a delete carries nothing more", () => {
    const cap = photoCaptionChange({ ...ctx, id: "a", caption: "Hoá đơn", now: NOW });
    expect(cap).toMatchObject({ entity: PHOTO_ENTITY, kind: "update", data: { caption: "Hoá đơn" }, fieldTimes: { caption: NOW.toISOString() } });
    expect(photoDeleteChange({ ...ctx, id: "a" })).toMatchObject({ entity: PHOTO_ENTITY, kind: "delete", data: { projectId: "p1", taskId: "t1" } });
  });
});

describe("the upload", () => {
  it("signs, uploads to Cloudinary with exactly what was signed, then records, and drops the local file", async () => {
    const s = setup();
    await s.queue.setOwner("u1");
    await s.queue.enqueue(upload());
    await s.queue.flush("u1");

    expect(s.calls).toEqual(["sign", "upload", "record"]);
    const [url, init] = (s.deps.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { method: string; body: FormData }];
    expect(url).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    expect(init.method).toBe("POST");
    const keys = [...init.body.keys()].sort();
    expect(keys).toEqual(["api_key", "file", "public_id", "signature", "timestamp", "type"]);
    expect(init.body.get("api_key")).toBe("key123");
    expect(init.body.get("signature")).toBe("sig456");
    expect(init.body.get("public_id")).toBe(signature.publicId);
    expect(init.body.get("timestamp")).toBe("1700000000");
    expect(init.body.get("type")).toBe("authenticated");
    expect(s.deps.recordPhoto).toHaveBeenCalledWith("tok", "p1", "t1", { id: ID, publicId: signature.publicId, width: 1600, height: 1200 });
    expect(s.removed).toEqual([ID]);
    expect(await s.queue.count()).toBe(0);
  });

  it("sends a caption that was typed while the photo waited", async () => {
    const s = setup();
    await s.queue.setOwner("u1");
    await s.queue.enqueue(upload(ID, { caption: "  Mẫu cà phê " }));
    await s.queue.flush("u1");
    expect(s.deps.recordPhoto).toHaveBeenCalledWith("tok", "p1", "t1", expect.objectContaining({ caption: "Mẫu cà phê" }));
  });

  it("is listed as uploading only while it is being sent", async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    const s = setup({ deps: { fetch: fetchMock as unknown as typeof fetch } });
    await s.queue.setOwner("u1");
    await s.queue.enqueue(upload());
    expect(uploadingIds().has(ID)).toBe(false);
    const done = s.queue.flush("u1");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(uploadingIds().has(ID)).toBe(true);
    release(reply(200));
    await done;
    expect(uploadingIds().has(ID)).toBe(false);
  });

  it("survives an app restart: a new queue on the same storage still holds it, and sends it", async () => {
    const store = createMemoryStore();
    const first = setup({ store });
    await first.queue.setOwner("u1");
    await first.queue.enqueue(upload());

    const second = setup({ store });
    expect((await second.queue.waiting()).map((c) => [c.entity, c.entityId])).toEqual([[PHOTO_UPLOAD_ENTITY, ID]]);
    await second.queue.flush("u1");
    expect(second.calls).toEqual(["sign", "upload", "record"]);
    expect(await second.queue.count()).toBe(0);
  });

  it("stays queued when the phone is offline, and keeps the file", async () => {
    const s = setup({ deps: { fetch: vi.fn(async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch } });
    await s.queue.setOwner("u1");
    await s.queue.enqueue(upload());
    await s.queue.flush("u1");
    await settleFailures();
    expect(await s.queue.count()).toBe(1);
    expect((await loadPhotoCache(s.store, "u1")).failed).toEqual([]);
    expect(s.removed).toEqual([]);
    expect(uploadingIds().has(ID)).toBe(false);
  });

  it("stays queued when Cloudinary has a server error or is busy", async () => {
    for (const status of [500, 503, 429]) {
      const s = setup({ deps: { fetch: vi.fn(async () => reply(status)) as unknown as typeof fetch } });
      await s.queue.setOwner("u1");
      await s.queue.enqueue(upload());
      await s.queue.flush("u1");
      await settleFailures();
      expect(await s.queue.count(), `status ${status}`).toBe(1);
    }
  });

  it("stays queued while the API answers 503 photos_unavailable", async () => {
    const s = setup({ deps: { signPhoto: vi.fn(async () => { throw new ApiError("photos_unavailable", 503); }) } });
    await s.queue.setOwner("u1");
    await s.queue.enqueue(upload());
    await s.queue.flush("u1");
    await settleFailures();
    expect(await s.queue.count()).toBe(1);
    expect((await loadPhotoCache(s.store, "u1")).failed).toEqual([]);
  });

  it("becomes failed, keeping the file, when Cloudinary refuses the upload", async () => {
    const s = setup({ deps: { fetch: vi.fn(async () => reply(400)) as unknown as typeof fetch } });
    await s.queue.setOwner("u1");
    await s.queue.enqueue(upload());
    await s.queue.flush("u1");
    await settleFailures();
    expect(await s.queue.count()).toBe(0);
    const cache = await loadPhotoCache(s.store, "u1");
    expect(cache.failed.map((c) => [c.entity, c.entityId])).toEqual([[PHOTO_UPLOAD_ENTITY, ID]]);
    expect(s.removed).toEqual([]);
    expect(s.deps.recordPhoto).not.toHaveBeenCalled();
  });

  it("becomes failed when the API refuses it for good (photo limit, not involved)", async () => {
    for (const [code, status] of [["photo_limit_reached", 409], ["forbidden", 403]] as const) {
      const s = setup({ deps: { signPhoto: vi.fn(async () => { throw new ApiError(code, status); }) } });
      await s.queue.setOwner("u1");
      await s.queue.enqueue(upload());
      await s.queue.flush("u1");
      await settleFailures();
      expect((await loadPhotoCache(s.store, "u1")).failed, code).toHaveLength(1);
      expect(s.deps.fetch).not.toHaveBeenCalled();
    }
  });

  it("becomes failed without asking the server when the file is gone", async () => {
    const s = setup({ fileExists: false });
    await s.queue.setOwner("u1");
    await s.queue.enqueue(upload());
    await s.queue.flush("u1");
    await settleFailures();
    expect(s.deps.signPhoto).not.toHaveBeenCalled();
    expect((await loadPhotoCache(s.store, "u1")).failed).toHaveLength(1);
  });

  it("becomes failed without asking the server when the size is not a whole number from 1 to 20000", async () => {
    for (const [width, height] of [[0, 100], [100, 20001], [10.5, 10]]) {
      const s = setup();
      await s.queue.setOwner("u1");
      await s.queue.enqueue(upload(ID, { width, height }));
      await s.queue.flush("u1");
      await settleFailures();
      expect(s.deps.signPhoto, `${width}x${height}`).not.toHaveBeenCalled();
      expect((await loadPhotoCache(s.store, "u1")).failed).toHaveLength(1);
    }
  });

  it("does not use an answer from /sign that is missing what the upload needs", async () => {
    const s = setup({ deps: { signPhoto: vi.fn(async () => ({ ...signature, signature: "" })) } });
    await s.queue.setOwner("u1");
    await s.queue.enqueue(upload());
    await s.queue.flush("u1");
    await settleFailures();
    expect(s.deps.fetch).not.toHaveBeenCalled();
    expect(await s.queue.count()).toBe(1);
  });
});

describe("retry, discard and cancel", () => {
  async function failedUpload() {
    const s = setup({ deps: { fetch: vi.fn(async () => reply(400)) as unknown as typeof fetch } });
    await s.queue.setOwner("u1");
    await s.queue.enqueue(upload());
    await s.queue.flush("u1");
    await settleFailures();
    return s;
  }

  it("retry puts the upload back on the queue and forgets the failure", async () => {
    const s = await failedUpload();
    await retryFailed(s.queue, s.store, "u1", ID);
    expect((await s.queue.waiting()).map((c) => c.entityId)).toEqual([ID]);
    expect((await loadPhotoCache(s.store, "u1")).failed).toEqual([]);
  });

  it("a retried upload goes through when the cause is gone", async () => {
    const store = createMemoryStore();
    const bad = setup({ store, deps: { fetch: vi.fn(async () => reply(400)) as unknown as typeof fetch } });
    await bad.queue.setOwner("u1");
    await bad.queue.enqueue(upload());
    await bad.queue.flush("u1");
    await settleFailures();
    const good = setup({ store });
    await retryFailed(good.queue, store, "u1", ID);
    await good.queue.flush("u1");
    expect(good.calls).toEqual(["sign", "upload", "record"]);
  });

  it("discard forgets the failure and deletes the local file", async () => {
    const s = await failedUpload();
    await discardFailed(s.store, "u1", ID, s.deps.files);
    expect((await loadPhotoCache(s.store, "u1")).failed).toEqual([]);
    expect(s.removed).toEqual([ID]);
    expect(s.existing.has(ID)).toBe(false);
  });

  it("discarding a refused caption change leaves the photo's file alone", async () => {
    const s = setup({ deps: { patchPhotoCaption: vi.fn(async () => { throw new ApiError("forbidden", 403); }) } });
    await s.queue.setOwner("u1");
    await s.queue.enqueue(photoCaptionChange({ ...ctx, id: ID, caption: "x", now: NOW }));
    await s.queue.flush("u1");
    await settleFailures();
    expect((await loadPhotoCache(s.store, "u1")).failed).toHaveLength(1);
    await discardFailed(s.store, "u1", ID, s.deps.files);
    expect(s.removed).toEqual([]);
  });

  it("cancelling a waiting upload takes it off the queue and deletes the file", async () => {
    const s = setup();
    await s.queue.setOwner("u1");
    await s.queue.enqueue(upload());
    await cancelUpload(s.queue, s.deps.files, ID);
    expect(await s.queue.count()).toBe(0);
    expect(s.removed).toEqual([ID]);
  });
});

describe("caption and delete of a photo the server has", () => {
  it("sends the caption with the time it was written, and the delete", async () => {
    const s = setup();
    await s.queue.setOwner("u1");
    await s.queue.enqueue(photoCaptionChange({ ...ctx, id: "a", caption: "", now: NOW }));
    await s.queue.enqueue(photoDeleteChange({ ...ctx, id: "b" }));
    await s.queue.flush("u1");
    expect(s.deps.patchPhotoCaption).toHaveBeenCalledWith("tok", "p1", "t1", "a", { value: "", editedAt: NOW.toISOString() });
    expect(s.deps.deletePhoto).toHaveBeenCalledWith("tok", "p1", "t1", "b");
  });

  it("an offline caption change waits in the queue", async () => {
    const s = setup({ deps: { patchPhotoCaption: vi.fn(async () => { throw new ApiError("network"); }) } });
    await s.queue.setOwner("u1");
    await s.queue.enqueue(photoCaptionChange({ ...ctx, id: "a", caption: "x", now: NOW }));
    await s.queue.flush("u1");
    expect(await s.queue.count()).toBe(1);
  });
});
