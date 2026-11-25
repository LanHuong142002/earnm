import { describe, expect, it } from "vitest";

import { isReconnect } from "../sync/reconnect";
import { createMemoryStore } from "../sync/storage";
import { addPendingRead, flushPendingRead, loadPendingRead, READ_BATCH } from "./pendingRead";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i}`);

describe("pending reads (AC34)", () => {
  it("keeps ids marked read offline, once each, per person", async () => {
    const store = createMemoryStore();
    await addPendingRead(store, "u1", ["a", "b"]);
    await addPendingRead(store, "u1", ["b", "c"]);
    expect(await loadPendingRead(store, "u1")).toEqual(["a", "b", "c"]);
    expect(await loadPendingRead(store, "u2")).toEqual([]);
  });

  it("stays waiting while the phone is offline", async () => {
    const store = createMemoryStore();
    await addPendingRead(store, "u1", ["a", "b"]);
    const result = await flushPendingRead(store, "u1", async () => {
      throw new Error("network");
    });
    expect(result).toBe("failed");
    expect(await loadPendingRead(store, "u1")).toEqual(["a", "b"]);
  });

  it("is sent and cleared when the phone comes back online", async () => {
    const store = createMemoryStore();
    await addPendingRead(store, "u1", ["a", "b"]);
    const sent: string[][] = [];
    // The phone goes from offline to online: that is when the flush runs.
    const offline = { isConnected: false, isInternetReachable: false };
    const online = { isConnected: true, isInternetReachable: true };
    expect(isReconnect(offline, online)).toBe(true);
    expect(await flushPendingRead(store, "u1", async (batch) => void sent.push(batch))).toBe("sent");
    expect(sent).toEqual([["a", "b"]]);
    expect(await loadPendingRead(store, "u1")).toEqual([]);
    expect(await flushPendingRead(store, "u1", async () => void sent.push([]))).toBe("empty");
    expect(sent).toHaveLength(1);
  });

  it("sends in batches the server accepts and keeps the rest after a failure", async () => {
    const store = createMemoryStore();
    await addPendingRead(store, "u1", ids(READ_BATCH + 20));
    let calls = 0;
    const result = await flushPendingRead(store, "u1", async (batch) => {
      calls += 1;
      expect(batch.length).toBeLessThanOrEqual(READ_BATCH);
      if (calls === 2) throw new Error("network");
    });
    expect(result).toBe("failed");
    expect(await loadPendingRead(store, "u1")).toEqual(ids(READ_BATCH + 20).slice(READ_BATCH));
  });

  it("keeps ids added while a send is on its way", async () => {
    const store = createMemoryStore();
    await addPendingRead(store, "u1", ["a"]);
    await flushPendingRead(store, "u1", async () => {
      await addPendingRead(store, "u1", ["late"]);
    });
    expect(await loadPendingRead(store, "u1")).toEqual(["late"]);
  });

  it("drops a batch the server refuses for good", async () => {
    const store = createMemoryStore();
    await addPendingRead(store, "u1", ["a"]);
    const result = await flushPendingRead(
      store,
      "u1",
      async () => {
        throw new Error("bad ids");
      },
      () => true,
    );
    expect(result).toBe("sent");
    expect(await loadPendingRead(store, "u1")).toEqual([]);
  });
});
