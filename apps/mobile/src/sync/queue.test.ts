import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { createQueue, type Change, type Sender } from "./queue";
import { createMemoryStore, type KeyValueStore } from "./storage";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-01T00:00:01.000Z";

function setup(opts: { store?: KeyValueStore; token?: string | null } = {}) {
  const store = opts.store ?? createMemoryStore();
  const sent: Change[] = [];
  const sender = vi.fn<Sender>(async (change) => {
    sent.push(change);
    return { ok: change.changeId };
  });
  const onApplied = vi.fn();
  const onRejected = vi.fn();
  const onSignedOut = vi.fn();
  const token: string | null = opts.token === undefined ? "tok" : opts.token;
  const queue = createQueue({
    store,
    getToken: async () => token,
    onApplied,
    onRejected,
    onSignedOut,
  });
  queue.registerEntity("thing", { create: sender, update: sender, delete: sender });
  return { store, queue, sender, sent, onApplied, onRejected, onSignedOut };
}

const ids = (cs: Change[]) => cs.map((c) => `${c.kind}:${c.entityId}`);
const mk = (entityId: string, kind: "create" | "update" | "delete" = "create") => ({
  entity: "thing",
  entityId,
  kind,
  data: {},
  fieldTimes: {},
});

describe("merging", () => {
  it("update + update keeps one change with the latest value per field", async () => {
    const { queue } = setup();
    await queue.enqueue({ ...mk("a", "update"), data: { name: "x", note: "n" }, fieldTimes: { name: T1, note: T1 } });
    await queue.enqueue({ ...mk("a", "update"), data: { name: "y" }, fieldTimes: { name: T2 } });
    const w = await queue.waiting();
    expect(w).toHaveLength(1);
    expect(w[0].data).toEqual({ name: "y", note: "n" });
    expect(w[0].fieldTimes).toEqual({ name: T2, note: T1 });
  });

  it("an older edit does not overwrite a newer field value", async () => {
    const { queue } = setup();
    await queue.enqueue({ ...mk("a", "update"), data: { name: "new" }, fieldTimes: { name: T2 } });
    await queue.enqueue({ ...mk("a", "update"), data: { name: "old" }, fieldTimes: { name: T1 } });
    const w = await queue.waiting();
    expect(w[0].data).toEqual({ name: "new" });
    expect(w[0].fieldTimes).toEqual({ name: T2 });
  });

  it("equal times: the newer enqueue wins", async () => {
    const { queue } = setup();
    await queue.enqueue({ ...mk("a", "update"), data: { name: "1" }, fieldTimes: { name: T1 } });
    await queue.enqueue({ ...mk("a", "update"), data: { name: "2" }, fieldTimes: { name: T1 } });
    expect((await queue.waiting())[0].data).toEqual({ name: "2" });
  });

  it("create + update folds into one create with the latest values", async () => {
    const { queue } = setup();
    await queue.enqueue({ ...mk("a", "create"), data: { name: "x", note: "n" }, fieldTimes: { name: T1, note: T1 } });
    await queue.enqueue({ ...mk("a", "update"), data: { name: "y" }, fieldTimes: { name: T2 } });
    const w = await queue.waiting();
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe("create");
    expect(w[0].data).toEqual({ name: "y", note: "n" });
    expect(w[0].fieldTimes).toEqual({ name: T2, note: T1 });
  });

  it("create + delete leaves nothing to send", async () => {
    const { queue, sender } = setup();
    await queue.enqueue(mk("a", "create"));
    await queue.enqueue(mk("a", "delete"));
    expect(await queue.waiting()).toEqual([]);
    expect(await queue.count()).toBe(0);
    await queue.flush();
    expect(sender).not.toHaveBeenCalled();
  });

  it("update + delete becomes a single delete", async () => {
    const { queue } = setup();
    await queue.enqueue({ ...mk("a", "update"), data: { name: "x" }, fieldTimes: { name: T1 } });
    await queue.enqueue(mk("a", "delete"));
    expect(ids(await queue.waiting())).toEqual(["delete:a"]);
  });

  it("a merged change keeps its original position", async () => {
    const { queue } = setup();
    await queue.enqueue({ ...mk("a", "update"), data: { n: 1 }, fieldTimes: { n: T1 } });
    await queue.enqueue({ ...mk("b", "update"), data: { n: 1 }, fieldTimes: { n: T1 } });
    await queue.enqueue({ ...mk("a", "update"), data: { n: 2 }, fieldTimes: { n: T2 } });
    expect((await queue.waiting()).map((c) => c.entityId)).toEqual(["a", "b"]);
  });

  it("does not merge across different entities with the same id", async () => {
    const { queue } = setup();
    queue.registerEntity("other", { create: async () => ({}), update: async () => ({}), delete: async () => ({}) });
    await queue.enqueue({ ...mk("a", "update") });
    await queue.enqueue({ ...mk("a", "update"), entity: "other" });
    expect(await queue.count()).toBe(2);
  });

  it("enqueue for an unregistered entity throws", async () => {
    const { queue } = setup();
    await expect(queue.enqueue({ ...mk("a"), entity: "nope" })).rejects.toThrow();
  });

  it("a change being sent is not merged into", async () => {
    const { queue } = setup();
    const sent: Change[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    queue.registerEntity("slow", {
      create: async () => ({}),
      update: async (c) => {
        sent.push(c);
        await gate;
        return {};
      },
      delete: async () => ({}),
    });
    await queue.enqueue({ ...mk("a", "update"), entity: "slow", data: { n: 1 }, fieldTimes: { n: T1 } });
    const flushing = queue.flush();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await queue.enqueue({ ...mk("a", "update"), entity: "slow", data: { n: 2 }, fieldTimes: { n: T2 } });
    expect(await queue.count()).toBe(2);
    release();
    await flushing;
    expect(sent.map((c) => c.data.n)).toEqual([1, 2]);
    expect(await queue.count()).toBe(0);
  });
});

describe("flush", () => {
  it("sends in the order made, with the token", async () => {
    const { queue, sent, sender } = setup();
    await queue.enqueue(mk("a", "create"));
    await queue.enqueue({ ...mk("b", "update"), data: { n: 1 }, fieldTimes: { n: T1 } });
    await queue.enqueue(mk("c", "delete"));
    await queue.flush();
    expect(ids(sent)).toEqual(["create:a", "update:b", "delete:c"]);
    expect(sender.mock.calls[0][1]).toBe("tok");
  });

  it("does nothing without a token", async () => {
    const { queue, sender, onSignedOut } = setup({ token: null });
    await queue.enqueue(mk("a"));
    await queue.flush();
    expect(sender).not.toHaveBeenCalled();
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(await queue.count()).toBe(1);
  });

  it("accept removes the change and reports the response", async () => {
    const { queue, onApplied } = setup();
    await queue.enqueue(mk("a"));
    const [change] = await queue.waiting();
    await queue.flush();
    expect(await queue.count()).toBe(0);
    expect(onApplied).toHaveBeenCalledWith({ ...change, attempts: 1 }, { ok: change.changeId });
  });

  it("network failure keeps everything; a later flush sends again", async () => {
    const { queue, sender, sent } = setup();
    let fail = true;
    sender.mockImplementation(async (c) => {
      if (fail) throw new ApiError("network");
      sent.push(c);
      return {};
    });
    await queue.enqueue(mk("a"));
    await queue.enqueue(mk("b"));
    await queue.flush();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(await queue.count()).toBe(2);
    fail = false;
    await queue.flush();
    expect(ids(sent)).toEqual(["create:a", "create:b"]);
    expect(await queue.count()).toBe(0);
  });

  it("a flush during a running flush sends nothing twice; the rerun sends later changes", async () => {
    const { queue, sender, sent } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    sender.mockImplementation(async (c) => {
      sent.push(c);
      if (first) {
        first = false;
        await gate;
      }
      return {};
    });
    await queue.enqueue(mk("a"));
    const f1 = queue.flush();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const f2 = queue.flush();
    await queue.enqueue(mk("b"));
    release();
    await Promise.all([f1, f2]);
    expect(ids(sent)).toEqual(["create:a", "create:b"]);
    expect(await queue.count()).toBe(0);
  });

  for (const [label, err] of [
    ["403", new ApiError("forbidden", 403)],
    ["404", new ApiError("not_found", 404)],
    ["409", new ApiError("id_conflict", 409)],
    ["validation", new ApiError("validation_failed", 400)],
  ] as const) {
    it(`${label}: removes the change, reports it and keeps sending the rest`, async () => {
      const { queue, sender, onRejected, onApplied } = setup();
      sender.mockImplementationOnce(async () => {
        throw err;
      });
      await queue.enqueue(mk("a"));
      await queue.enqueue(mk("b"));
      const [first] = await queue.waiting();
      await queue.flush();
      expect(onRejected).toHaveBeenCalledWith({ ...first, attempts: 1 }, err);
      expect(onApplied).toHaveBeenCalledTimes(1);
      expect(sender).toHaveBeenCalledTimes(2);
      expect(await queue.count()).toBe(0);
    });
  }

  it("not_signed_in keeps everything, notifies, and sends nothing after it", async () => {
    const { queue, sender, onSignedOut, onRejected } = setup();
    sender.mockImplementationOnce(async () => {
      throw new ApiError("not_signed_in", 401);
    });
    await queue.enqueue(mk("a"));
    await queue.enqueue(mk("b"));
    await queue.flush();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(onRejected).not.toHaveBeenCalled();
    expect(await queue.count()).toBe(2);
  });

  it("another error stops and keeps", async () => {
    const { queue, sender, onRejected } = setup();
    sender.mockImplementationOnce(async () => {
      throw new ApiError("server_error", 500);
    });
    await queue.enqueue(mk("a"));
    await queue.enqueue(mk("b"));
    await queue.flush();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(onRejected).not.toHaveBeenCalled();
    expect(await queue.count()).toBe(2);
  });
});

describe("persistence and owner", () => {
  it("waiting changes survive a new queue on the same store", async () => {
    const a = setup();
    await a.queue.setOwner("u1");
    await a.queue.enqueue({ ...mk("a"), data: { n: 1 }, fieldTimes: { n: T1 } });
    const before = await a.queue.waiting();
    const b = setup({ store: a.store });
    expect(await b.queue.waiting()).toEqual(before);
    expect(await b.queue.ownerId()).toBe("u1");
    await b.queue.flush();
    expect(ids(b.sent)).toEqual(["create:a"]);
    const c = setup({ store: a.store });
    expect(await c.queue.count()).toBe(0);
  });

  it("setOwner with a different user clears the changes", async () => {
    const { queue } = setup();
    await queue.setOwner("u1");
    await queue.enqueue(mk("a"));
    expect(await queue.setOwner("u2")).toBe(true);
    expect(await queue.count()).toBe(0);
    expect(await queue.ownerId()).toBe("u2");
  });

  it("setOwner with the same user keeps the changes", async () => {
    const { queue } = setup();
    await queue.setOwner("u1");
    await queue.enqueue(mk("a"));
    expect(await queue.setOwner("u1")).toBe(false);
    expect(await queue.count()).toBe(1);
  });

  it("setOwner when no owner was stored keeps existing changes", async () => {
    const { queue } = setup();
    await queue.enqueue(mk("a"));
    expect(await queue.setOwner("u1")).toBe(false);
    expect(await queue.count()).toBe(1);
  });

  it("clear removes changes but keeps the owner; clear({owner:true}) drops it too", async () => {
    const { queue } = setup();
    await queue.setOwner("u1");
    await queue.enqueue(mk("a"));
    await queue.clear();
    expect(await queue.count()).toBe(0);
    expect(await queue.ownerId()).toBe("u1");
    await queue.clear({ owner: true });
    expect(await queue.ownerId()).toBeNull();
  });
});

describe("a create whose reply was lost (finding A)", () => {
  it("create -> network failure -> rename -> flush sends POST then a separate update, queue empty", async () => {
    const { queue, sender, sent } = setup();
    let fail = true;
    sender.mockImplementation(async (c) => {
      if (fail) throw new ApiError("network");
      sent.push(c);
      return {};
    });
    await queue.enqueue({ ...mk("a", "create"), data: { name: "Old" }, fieldTimes: { name: T1 } });
    await queue.flush();
    expect(sender).toHaveBeenCalledTimes(1);
    expect((await queue.waiting())[0].attempts).toBe(1);

    await queue.enqueue({ ...mk("a", "update"), data: { name: "New" }, fieldTimes: { name: T2 } });
    expect(ids(await queue.waiting())).toEqual(["create:a", "update:a"]);
    expect((await queue.waiting())[0].data).toEqual({ name: "Old" });

    fail = false;
    await queue.flush();
    expect(ids(sent)).toEqual(["create:a", "update:a"]);
    expect(sent[1].data).toEqual({ name: "New" });
    expect(sent[1].fieldTimes).toEqual({ name: T2 });
    expect(await queue.count()).toBe(0);
  });

  it("the attempt is persisted before sending", async () => {
    const a = setup();
    a.sender.mockImplementation(async () => {
      throw new ApiError("network");
    });
    await a.queue.enqueue(mk("a", "create"));
    await a.queue.flush();
    const b = setup({ store: a.store });
    expect((await b.queue.waiting())[0].attempts).toBe(1);
    await b.queue.enqueue({ ...mk("a", "update"), data: { n: 1 }, fieldTimes: { n: T1 } });
    expect(ids(await b.queue.waiting())).toEqual(["create:a", "update:a"]);
  });

  it("create + delete after an attempt keeps both (the server may already have it)", async () => {
    const { queue, sender } = setup();
    sender.mockImplementationOnce(async () => {
      throw new ApiError("network");
    });
    await queue.enqueue(mk("a", "create"));
    await queue.flush();
    await queue.enqueue(mk("a", "delete"));
    expect(ids(await queue.waiting())).toEqual(["create:a", "delete:a"]);
  });

  it("a later update merges into the appended update, not the attempted create", async () => {
    const { queue, sender } = setup();
    sender.mockImplementationOnce(async () => {
      throw new ApiError("network");
    });
    await queue.enqueue({ ...mk("a", "create"), data: { name: "O" }, fieldTimes: { name: T1 } });
    await queue.flush();
    await queue.enqueue({ ...mk("a", "update"), data: { name: "N1" }, fieldTimes: { name: T2 } });
    await queue.enqueue({ ...mk("a", "update"), data: { name: "N2" }, fieldTimes: { name: T2 } });
    const w = await queue.waiting();
    expect(ids(w)).toEqual(["create:a", "update:a"]);
    expect(w[1].data).toEqual({ name: "N2" });
  });
});

describe("persistence failures (finding D)", () => {
  it("a failed save rolls the change back, so it is not sent later and a retry does not duplicate", async () => {
    const inner = createMemoryStore();
    let failNext = true;
    const store: KeyValueStore = {
      ...inner,
      setJSON: async (k, v) => {
        if (failNext) {
          failNext = false;
          throw new Error("disk full");
        }
        return inner.setJSON(k, v);
      },
    };
    const { queue, sent } = setup({ store });
    await queue.setOwner("u1").catch(() => {}); // consumes the one failure only if it writes
    failNext = true;
    await expect(queue.enqueue(mk("a"))).rejects.toThrow("disk full");
    expect(await queue.count()).toBe(0);
    await queue.enqueue(mk("a")); // the retry
    await queue.flush();
    expect(ids(sent)).toEqual(["create:a"]);
  });

  it("a failed save restores a merged update", async () => {
    const inner = createMemoryStore();
    let fail = false;
    const store: KeyValueStore = {
      ...inner,
      setJSON: async (k, v) => {
        if (fail) throw new Error("disk full");
        return inner.setJSON(k, v);
      },
    };
    const { queue } = setup({ store });
    await queue.enqueue({ ...mk("a"), data: { name: "N1" }, fieldTimes: { name: T1 } });
    fail = true;
    await expect(queue.enqueue({ ...mk("a", "update"), data: { name: "N2" }, fieldTimes: { name: T2 } })).rejects.toThrow();
    const w = await queue.waiting();
    expect(w).toHaveLength(1);
    expect(w[0].data).toEqual({ name: "N1" });
  });

  it("one rejected write does not poison later writes", async () => {
    const inner = createMemoryStore();
    let failNext = true;
    const store: KeyValueStore = {
      ...inner,
      setJSON: async (k, v) => {
        if (failNext) {
          failNext = false;
          throw new Error("disk full");
        }
        return inner.setJSON(k, v);
      },
    };
    const { queue } = setup({ store });
    await expect(queue.enqueue(mk("a"))).rejects.toThrow("disk full");
    await expect(queue.enqueue(mk("b"))).resolves.toBeDefined();
    const again = setup({ store: inner });
    expect((await again.queue.waiting()).map((c) => c.entityId)).toContain("b");
  });

  it("a failed first load is retried, not cached forever", async () => {
    const inner = createMemoryStore();
    await inner.setJSON("sync.queue.v1", { ownerId: "u1", changes: [] });
    let failNext = true;
    const store: KeyValueStore = {
      ...inner,
      getJSON: async <T,>(k: string) => {
        if (failNext) {
          failNext = false;
          throw new Error("read failed");
        }
        return inner.getJSON<T>(k);
      },
    };
    const { queue } = setup({ store });
    await expect(queue.waiting()).rejects.toThrow("read failed");
    expect(await queue.ownerId()).toBe("u1");
  });
});

describe("permanent rejections and malformed data (finding F)", () => {
  for (const [label, err] of [
    ["400 bad_request", new ApiError("bad_request", 400)],
    ["400 invalid_json", new ApiError("invalid_json", 400)],
    ["413", new ApiError("too_large", 413)],
  ] as const) {
    it(`${label} is rejected for good and the rest keeps going`, async () => {
      const { queue, sender, onRejected } = setup();
      sender.mockImplementationOnce(async () => {
        throw err;
      });
      await queue.enqueue(mk("a"));
      await queue.enqueue(mk("b"));
      await queue.flush();
      expect(onRejected).toHaveBeenCalledTimes(1);
      expect(sender).toHaveBeenCalledTimes(2);
      expect(await queue.count()).toBe(0);
    });
  }

  for (const [label, err] of [
    ["401 other", new ApiError("something", 401)],
    ["408", new ApiError("timeout", 408)],
    ["429", new ApiError("rate_limited", 429)],
  ] as const) {
    it(`${label} is retryable: kept, nothing rejected`, async () => {
      const { queue, sender, onRejected } = setup();
      sender.mockImplementationOnce(async () => {
        throw err;
      });
      await queue.enqueue(mk("a"));
      await queue.flush();
      expect(onRejected).not.toHaveBeenCalled();
      expect(await queue.count()).toBe(1);
    });
  }

  it("malformed persisted changes are dropped on load", async () => {
    const store = createMemoryStore();
    const good = { changeId: "g", entity: "thing", entityId: "g", kind: "create", data: {}, fieldTimes: {}, createdAt: T1 };
    await store.setJSON("sync.queue.v1", {
      ownerId: "u1",
      changes: [
        { ...good, kind: "explode", changeId: "x1" },
        { ...good, entityId: undefined, changeId: "x2" },
        { ...good, data: "nope", changeId: "x3" },
        { ...good, changeId: "" },
        null,
        good,
      ],
    });
    const { queue, sent } = setup({ store });
    expect((await queue.waiting()).map((c) => c.changeId)).toEqual(["g"]);
    await queue.flush("u1");
    expect(ids(sent)).toEqual(["create:g"]);
  });

  it("a change for an entity with no senders is kept and stops the queue without being rejected", async () => {
    const store = createMemoryStore();
    await store.setJSON("sync.queue.v1", {
      ownerId: null,
      changes: [{ changeId: "u", entity: "unknown", entityId: "u", kind: "create", data: {}, fieldTimes: {}, createdAt: T1 }],
    });
    const { queue, sender, onRejected } = setup({ store });
    await queue.flush();
    expect(sender).not.toHaveBeenCalled();
    expect(onRejected).not.toHaveBeenCalled();
    expect(await queue.count()).toBe(1);
  });
});

describe("delete answered 404 (finding G)", () => {
  it("is success: removed and applied, not rejected", async () => {
    const { queue, sender, onApplied, onRejected } = setup();
    sender.mockImplementationOnce(async () => {
      throw new ApiError("not_found", 404);
    });
    await queue.enqueue(mk("a", "delete"));
    const [change] = await queue.waiting();
    await queue.flush();
    expect(onRejected).not.toHaveBeenCalled();
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ changeId: change.changeId }), undefined);
    expect(await queue.count()).toBe(0);
  });
});

describe("owner check before sending (finding H)", () => {
  it("sends nothing when the stored owner is not the expected one", async () => {
    const { queue, sender } = setup();
    await queue.setOwner("A");
    await queue.enqueue(mk("a"));
    await queue.flush("B");
    expect(sender).not.toHaveBeenCalled();
    expect(await queue.count()).toBe(1);
  });

  it("sends nothing when the owner is unknown while changes exist, or the expected id is null", async () => {
    const { queue, sender } = setup();
    await queue.enqueue(mk("a"));
    await queue.flush("A");
    await queue.setOwner("A");
    await queue.flush(null);
    expect(sender).not.toHaveBeenCalled();
    await queue.flush("A");
    expect(sender).toHaveBeenCalledTimes(1);
  });
});

describe("signing back in (AC27)", () => {
  it("not_signed_in keeps the change; same user signing back in sends it with a valid token", async () => {
    const store = createMemoryStore();
    const sent: Change[] = [];
    let token: string | null = "expired";
    const onSignedOut = vi.fn();
    const sender = vi.fn<Sender>(async (c, tk) => {
      if (tk === "expired") throw new ApiError("not_signed_in", 401);
      sent.push(c);
      return {};
    });
    const queue = createQueue({
      store,
      getToken: async () => token,
      onApplied: vi.fn(),
      onRejected: vi.fn(),
      onSignedOut,
    });
    queue.registerEntity("thing", { create: sender, update: sender, delete: sender });
    await queue.setOwner("u1");
    await queue.enqueue(mk("a"));
    await queue.flush("u1");
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(await queue.count()).toBe(1);

    expect(await queue.setOwner("u1")).toBe(false);
    expect(await queue.count()).toBe(1);
    token = "fresh";
    await queue.flush("u1");
    expect(ids(sent)).toEqual(["create:a"]);
    expect(await queue.count()).toBe(0);
  });
});

describe("sign-out fence and rerun owner", () => {
  it("a send that returns after clear({ owner: true }) is not applied or re-added", async () => {
    const { queue, sender, onApplied, onRejected } = setup();
    let release!: (v: unknown) => void;
    sender.mockImplementation(() => new Promise((r) => (release = r)));
    await queue.setOwner("A");
    await queue.enqueue(mk("a"));
    const flushing = queue.flush("A");
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    await queue.clear({ owner: true });
    release({ id: "a" });
    await flushing;
    expect(onApplied).not.toHaveBeenCalled();
    expect(onRejected).not.toHaveBeenCalled();
    expect(await queue.count()).toBe(0);
    expect(await queue.ownerId()).toBeNull();
  });

  it("a failed send that returns after clear is not rejected either", async () => {
    const { queue, sender, onRejected, onSignedOut } = setup();
    let fail!: (e: unknown) => void;
    sender.mockImplementation(() => new Promise((_, rej) => (fail = rej)));
    await queue.enqueue(mk("a"));
    const flushing = queue.flush();
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    await queue.clear();
    fail(new ApiError("validation_failed", 400));
    await flushing;
    expect(onRejected).not.toHaveBeenCalled();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("setOwner dropping another person's changes also fences an in-flight send", async () => {
    const { queue, sender, onApplied } = setup();
    let release!: (v: unknown) => void;
    sender.mockImplementation(() => new Promise((r) => (release = r)));
    await queue.setOwner("A");
    await queue.enqueue(mk("a"));
    const flushing = queue.flush("A");
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    expect(await queue.setOwner("B")).toBe(true);
    release({});
    await flushing;
    expect(onApplied).not.toHaveBeenCalled();
    expect(await queue.count()).toBe(0);
  });

  it("after a fenced send, a flush for the new owner made meanwhile still sends their change", async () => {
    const { queue, sender, sent } = setup();
    let release!: (v: unknown) => void;
    sender.mockImplementationOnce(() => new Promise((r) => (release = r)));
    await queue.setOwner("A");
    await queue.enqueue(mk("a"));
    const flushing = queue.flush("A");
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    expect(await queue.setOwner("B")).toBe(true);
    await queue.enqueue(mk("b"));
    void queue.flush("B");
    release({});
    await flushing;
    expect(ids(sent)).toEqual(["create:b"]);
    expect(await queue.count()).toBe(0);
  });

  it("the rerun uses the latest requested owner id, not the first caller's", async () => {
    const store = createMemoryStore();
    const sent: Change[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sender = vi.fn<Sender>(async (change) => {
      sent.push(change);
      if (change.entityId === "a") await gate;
      return {};
    });
    let queue: ReturnType<typeof createQueue>;
    queue = createQueue({
      store,
      getToken: async () => "tok",
      onApplied: (change) => {
        // A change for the same stored owner shows up just after the first pass finishes.
        if (change.entityId === "a") void queue.enqueue(mk("b"));
      },
      onRejected: vi.fn(),
      onSignedOut: vi.fn(),
    });
    queue.registerEntity("thing", { create: sender, update: sender, delete: sender });
    await queue.setOwner("u1");
    await queue.enqueue(mk("a"));
    const f1 = queue.flush("u1");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const f2 = queue.flush("u2"); // someone else is now signed in
    release();
    await Promise.all([f1, f2]);
    expect(ids(sent)).toEqual(["create:a"]); // u1's change b is never sent for u2
    expect(await queue.count()).toBe(1);
  });
});

describe("per-entity result handlers", () => {
  function setupWithHandlers() {
    const base = setup();
    const other = vi.fn<Sender>(async () => ({ ok: "other" }));
    const failing = vi.fn<Sender>(async () => {
      throw new ApiError("validation_failed", 422, "bad");
    });
    const handlers = { onApplied: vi.fn(), onRejected: vi.fn() };
    base.queue.registerEntity("other", { create: other, update: other, delete: other }, handlers);
    base.queue.registerEntity("bad", { create: failing, update: failing, delete: failing }, handlers);
    return { ...base, other, failing, handlers };
  }

  it("an applied change for an entity with handlers reaches only those handlers", async () => {
    const { queue, onApplied, handlers } = setupWithHandlers();
    await queue.setOwner("u1");
    const change = await queue.enqueue({ entity: "other", entityId: "o1", kind: "create", data: {}, fieldTimes: {} });
    await queue.flush("u1");
    expect(handlers.onApplied).toHaveBeenCalledTimes(1);
    expect(handlers.onApplied).toHaveBeenCalledWith({ ...change, attempts: 1 }, { ok: "other" });
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("a rejected change for an entity with handlers reaches only those handlers", async () => {
    const { queue, onRejected, handlers } = setupWithHandlers();
    await queue.setOwner("u1");
    await queue.enqueue({ entity: "bad", entityId: "b1", kind: "create", data: {}, fieldTimes: {} });
    await queue.flush("u1");
    expect(handlers.onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("a 404 on delete is applied through the entity's handler", async () => {
    const { queue, onApplied, handlers, other } = setupWithHandlers();
    other.mockRejectedValueOnce(new ApiError("not_found", 404, "gone"));
    await queue.setOwner("u1");
    await queue.enqueue({ entity: "other", entityId: "o1", kind: "delete", data: {}, fieldTimes: {} });
    await queue.flush("u1");
    expect(handlers.onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("a change for an entity registered without handlers still reaches the queue-level handlers", async () => {
    const { queue, onApplied, handlers } = setupWithHandlers();
    await queue.setOwner("u1");
    await queue.enqueue(mk("a"));
    await queue.flush("u1");
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(handlers.onApplied).not.toHaveBeenCalled();
  });

  it("an entity with only one handler falls back to the queue-level handler for the other", async () => {
    const { queue, onRejected, onApplied } = setup();
    const failing = vi.fn<Sender>(async () => {
      throw new ApiError("validation_failed", 422, "bad");
    });
    const partial = { onApplied: vi.fn() };
    queue.registerEntity("part", { create: failing, update: failing, delete: failing }, partial);
    await queue.setOwner("u1");
    await queue.enqueue({ entity: "part", entityId: "p1", kind: "create", data: {}, fieldTimes: {} });
    await queue.flush("u1");
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(partial.onApplied).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });
});

describe("dropEntity", () => {
  it("removes every queued change for that entity id, keeps others, and persists", async () => {
    const { queue, store } = setup();
    await queue.enqueue(mk("a", "update"));
    await queue.enqueue(mk("b", "update"));
    await queue.dropEntity("thing", "a");
    expect(ids(await queue.waiting())).toEqual(["update:b"]);
    const reloaded = setup({ store });
    expect(ids(await reloaded.queue.waiting())).toEqual(["update:b"]);
  });

  it("only matches the given entity name", async () => {
    const { queue } = setup();
    await queue.enqueue(mk("a", "update"));
    await queue.dropEntity("other", "a");
    expect(await queue.count()).toBe(1);
  });

  it("an in-flight send for the dropped entity is not re-added, applied or rejected", async () => {
    const { queue, sender, onApplied, onRejected } = setup();
    let release!: (v: unknown) => void;
    sender.mockImplementation(() => new Promise((r) => (release = r)));
    await queue.enqueue(mk("a", "update"));
    const flushing = queue.flush();
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    await queue.dropEntity("thing", "a");
    release({ id: "a" });
    await flushing;
    expect(onApplied).not.toHaveBeenCalled();
    expect(onRejected).not.toHaveBeenCalled();
    expect(await queue.count()).toBe(0);
  });

  it("a failed in-flight send for the dropped entity is not rejected", async () => {
    const { queue, sender, onRejected } = setup();
    let fail!: (e: unknown) => void;
    sender.mockImplementation(() => new Promise((_, rej) => (fail = rej)));
    await queue.enqueue(mk("a", "update"));
    const flushing = queue.flush();
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    await queue.dropEntity("thing", "a");
    fail(new ApiError("forbidden", 403));
    await flushing;
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("an in-flight send for another entity is unaffected and the queue carries on", async () => {
    const { queue, sender, onApplied } = setup();
    let release!: (v: unknown) => void;
    sender.mockImplementationOnce(() => new Promise((r) => (release = r)));
    await queue.enqueue(mk("a", "update"));
    await queue.enqueue(mk("b", "update"));
    const flushing = queue.flush();
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    await queue.dropEntity("thing", "b");
    release({ id: "a" });
    await flushing;
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied.mock.calls[0][0].entityId).toBe("a");
    expect(await queue.count()).toBe(0);
  });
});
