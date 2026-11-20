import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { createQueue, type Change, type Queue } from "../sync/queue";
import { createMemoryStore } from "../sync/storage";
import { draft } from "./fixtures";
import {
  draftCreateChange,
  draftDeleteChange,
  draftLineCreateChange,
  draftLineDeleteChange,
  draftLineUpdateChange,
  draftStatusChange,
  draftUpdateChange,
  registerDraftEntities,
} from "./sync";

const T0 = new Date("2026-11-18T09:00:00.000Z");
const T1 = new Date("2026-11-18T09:01:00.000Z");
const T2 = new Date("2026-11-18T09:02:00.000Z");

const newQueue = () =>
  createQueue({ store: createMemoryStore(), getToken: async () => "tok", onApplied: () => {}, onRejected: () => {}, onSignedOut: () => {} });

function setup() {
  const applied: Change[] = [];
  const rejected: Change[] = [];
  const queue = newQueue();
  const deps = {
    createDraft: vi.fn(async (_t: string, _p: string, b: { id: string }) => draft({ id: b.id })),
    patchDraft: vi.fn(async (_t: string, _p: string, id: string, _f: unknown) => draft({ id })),
    deleteDraft: vi.fn(async () => undefined),
    createDraftLine: vi.fn(async (_t: string, _p: string, id: string, _b: unknown) => draft({ id })),
    patchDraftLine: vi.fn(async (_t: string, _p: string, id: string, _l: string, _f: unknown) => draft({ id })),
    deleteDraftLine: vi.fn(async () => undefined),
  };
  registerDraftEntities(queue, { onApplied: (c) => void applied.push(c), onRejected: (c) => void rejected.push(c) }, deps);
  return { queue, deps, applied, rejected };
}

const ids = async (queue: Queue) => (await queue.waiting()).map((c) => `${c.entity}:${c.entityId}:${c.kind}`);
const base = { id: "d1", projectId: "p1" };

describe("queued draft changes merge per field (spec AC10)", () => {
  it("merges edits of one draft into one change, field by field, each with its own time", async () => {
    const { queue } = setup();
    await queue.enqueue(draftUpdateChange({ ...base, fields: { name: "A", note: "n" }, now: T0 }));
    await queue.enqueue(draftUpdateChange({ ...base, fields: { name: "B", expectedPrice: 45000 }, now: T1 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data).toMatchObject({ name: "B", note: "n", expectedPrice: 45000 });
    expect(waiting[0].fieldTimes).toMatchObject({ name: T1.toISOString(), note: T0.toISOString(), expectedPrice: T1.toISOString() });
  });

  it("keeps a clearing of the price (null) as a change", async () => {
    const { queue } = setup();
    await queue.enqueue(draftUpdateChange({ ...base, fields: { expectedPrice: 1000 }, now: T0 }));
    await queue.enqueue(draftUpdateChange({ ...base, fields: { expectedPrice: null }, now: T1 }));
    expect((await queue.waiting())[0].data.expectedPrice).toBeNull();
  });

  it("folds an edit made while the create waits into the create", async () => {
    const { queue } = setup();
    await queue.enqueue(draftCreateChange({ ...base, name: "A", sizes: ["M"], expectedPrice: null, note: "", now: T0 }));
    await queue.enqueue(draftUpdateChange({ ...base, fields: { name: "B" }, now: T1 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ kind: "create", data: { name: "B", sizes: ["M"] } });
  });

  it("drops a create and its edits when the draft is deleted before anything was sent", async () => {
    const { queue } = setup();
    await queue.enqueue(draftCreateChange({ ...base, name: "A", sizes: ["M"], expectedPrice: null, note: "", now: T0 }));
    await queue.enqueue(draftUpdateChange({ ...base, fields: { name: "B" }, now: T1 }));
    await queue.enqueue(draftDeleteChange(base));
    expect(await ids(queue)).toEqual([]);
  });

  it("merges status changes of one draft, the newest winning", async () => {
    const { queue } = setup();
    await queue.enqueue(draftStatusChange({ ...base, value: "done", now: T0 }));
    await queue.enqueue(draftStatusChange({ ...base, value: "working", now: T1 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data.value).toBe("working");
  });

  it("merges line edits per field and folds them into an unsent line create", async () => {
    const { queue } = setup();
    await queue.enqueue(
      draftLineCreateChange({
        draftId: "d1",
        projectId: "p1",
        line: { id: "l1", kind: "new", newName: "Vải", newKind: "weight", purchaseQty: null, purchasePrice: null, amount: 60 },
        now: T0,
      }),
    );
    await queue.enqueue(draftLineUpdateChange({ draftId: "d1", projectId: "p1", lineId: "l1", fields: { purchasePrice: 45000 }, now: T1 }));
    await queue.enqueue(draftLineUpdateChange({ draftId: "d1", projectId: "p1", lineId: "l1", fields: { purchaseQty: 565, amount: 70 }, now: T2 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ kind: "create", data: { newName: "Vải", purchasePrice: 45000, purchaseQty: 565, amount: 70 } });
  });

  it("drops a line that is created and deleted before anything was sent; keeps other lines apart", async () => {
    const { queue } = setup();
    const line = (id: string) => ({ id, kind: "existing" as const, ingredientId: "g1", amount: 5 });
    await queue.enqueue(draftLineCreateChange({ draftId: "d1", projectId: "p1", line: line("l1"), now: T0 }));
    await queue.enqueue(draftLineCreateChange({ draftId: "d1", projectId: "p1", line: line("l2"), now: T0 }));
    await queue.enqueue(draftLineDeleteChange({ draftId: "d1", projectId: "p1", lineId: "l1" }));
    expect(await ids(queue)).toEqual(["draftLine:l2:create"]);
  });

  it("sends in the order queued: the draft, then its lines, then its status", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(draftCreateChange({ ...base, name: "A", sizes: ["M"], expectedPrice: null, note: "", now: T0 }));
    await queue.enqueue(draftLineCreateChange({ draftId: "d1", projectId: "p1", line: { id: "l1", kind: "existing", ingredientId: "g1", amount: 5 }, now: T0 }));
    await queue.enqueue(draftStatusChange({ ...base, value: "done", now: T1 }));
    await queue.setOwner("u1");
    await queue.flush("u1");
    expect(deps.createDraft).toHaveBeenCalledWith("tok", "p1", { id: "d1", name: "A", sizes: ["M"], note: "" });
    expect(deps.createDraftLine).toHaveBeenCalledWith("tok", "p1", "d1", { id: "l1", kind: "existing", ingredientId: "g1", amount: 5 });
    expect(deps.patchDraft).toHaveBeenCalledWith("tok", "p1", "d1", { status: { value: "done", editedAt: T1.toISOString() } });
  });
});

describe("draft senders", () => {
  it("sends each draft field with its own time, and a cleared price as null", async () => {
    const { queue, deps } = setup();
    await queue.setOwner("u1");
    await queue.enqueue(draftUpdateChange({ ...base, fields: { name: "A", expectedPrice: null }, now: T0 }));
    await queue.flush("u1");
    expect(deps.patchDraft).toHaveBeenCalledWith("tok", "p1", "d1", {
      name: { value: "A", editedAt: T0.toISOString() },
      expectedPrice: { value: null, editedAt: T0.toISOString() },
    });
  });

  it("sends a new-ingredient line and only the changed fields of a line edit", async () => {
    const { queue, deps } = setup();
    await queue.setOwner("u1");
    await queue.enqueue(
      draftLineCreateChange({
        draftId: "d1",
        projectId: "p1",
        line: { id: "l1", kind: "new", newName: "Vải", newKind: "weight", purchaseQty: 565, purchasePrice: 45000, amount: 60 },
        now: T0,
      }),
    );
    await queue.enqueue(draftLineUpdateChange({ draftId: "d1", projectId: "p1", lineId: "l2", fields: { purchasePrice: null }, now: T1 }));
    await queue.flush("u1");
    expect(deps.createDraftLine).toHaveBeenCalledWith("tok", "p1", "d1", {
      id: "l1",
      kind: "new",
      newName: "Vải",
      newKind: "weight",
      purchaseQty: 565,
      purchasePrice: 45000,
      amount: 60,
    });
    expect(deps.patchDraftLine).toHaveBeenCalledWith("tok", "p1", "d1", "l2", { purchasePrice: { value: null, editedAt: T1.toISOString() } });
  });

  it("reports a refusal to the handlers", async () => {
    const { queue, deps, rejected } = setup();
    deps.patchDraft.mockRejectedValueOnce(new ApiError("draft_incomplete", 409, null, { missing: [{ code: "lines" }] }));
    await queue.setOwner("u1");
    await queue.enqueue(draftStatusChange({ ...base, value: "done", now: T0 }));
    await queue.flush("u1");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].entity).toBe("draftStatus");
  });
});
