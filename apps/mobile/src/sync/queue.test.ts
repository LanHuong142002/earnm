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
    expect(onApplied).toHaveBeenCalledWith(change, { ok: change.changeId });
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
      expect(onRejected).toHaveBeenCalledWith(first, err);
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
