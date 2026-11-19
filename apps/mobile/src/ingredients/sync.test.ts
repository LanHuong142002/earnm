import { describe, expect, it, vi } from "vitest";

import { createQueue, type Change, type Queue } from "../sync/queue";
import { createMemoryStore } from "../sync/storage";
import { ingredient } from "./fixtures";
import { ingredientCreateChange, ingredientDeleteChange, ingredientUpdateChange, registerIngredientEntities } from "./sync";

const T0 = new Date("2026-11-18T09:00:00.000Z");
const T1 = new Date("2026-11-18T09:01:00.000Z");
const T2 = new Date("2026-11-18T09:02:00.000Z");

const P1 = { quantity: 1000, unit: "kg", price: 25000 } as const;
const P2 = { quantity: 500, unit: "g", price: 14000 } as const;
const P3 = { quantity: 2000, unit: "kg", price: 40000 } as const;

function setup() {
  const applied: Change[] = [];
  const rejected: Change[] = [];
  const queue = createQueue({
    store: createMemoryStore(),
    getToken: async () => "tok",
    onApplied: () => {},
    onRejected: () => {},
    onSignedOut: () => {},
  });
  const deps = {
    createIngredient: vi.fn(async (_t: string, _p: string, body: { id: string }) => ingredient({ id: body.id })),
    patchIngredient: vi.fn(async (_t: string, _p: string, id: string) => ingredient({ id })),
    deleteIngredient: vi.fn(async () => undefined),
  };
  registerIngredientEntities(queue, { onApplied: (c) => void applied.push(c), onRejected: (c) => void rejected.push(c) }, deps);
  return { queue, deps, applied, rejected };
}

const ids = async (queue: Queue) => (await queue.waiting()).map((c) => `${c.entity}:${c.entityId}:${c.kind}`);

describe("queued ingredient changes merge per field (spec AC17)", () => {
  it("merges edits of one ingredient into one change, field by field, each with its own time", async () => {
    const { queue } = setup();
    await queue.enqueue(ingredientUpdateChange({ id: "g1", projectId: "p1", fields: { name: "A" }, now: T0 }));
    await queue.enqueue(ingredientUpdateChange({ id: "g1", projectId: "p1", fields: { name: "B", isDefault: true }, now: T1 }));
    await queue.enqueue(ingredientUpdateChange({ id: "g1", projectId: "p1", fields: { purchase: P2 }, now: T2 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data).toMatchObject({ name: "B", isDefault: true, purchase: P2 });
    expect(waiting[0].fieldTimes).toMatchObject({ name: T1.toISOString(), isDefault: T1.toISOString(), purchase: T2.toISOString() });
  });

  it("keeps the purchase as one whole field: a later purchase replaces it, never mixes with the earlier", async () => {
    const { queue } = setup();
    await queue.enqueue(ingredientUpdateChange({ id: "g1", projectId: "p1", fields: { purchase: P1 }, now: T0 }));
    await queue.enqueue(ingredientUpdateChange({ id: "g1", projectId: "p1", fields: { purchase: P2 }, now: T1 }));
    expect((await queue.waiting())[0].data.purchase).toEqual(P2);
  });

  it("keeps edits of two ingredients apart", async () => {
    const { queue } = setup();
    await queue.enqueue(ingredientUpdateChange({ id: "g1", projectId: "p1", fields: { name: "A" }, now: T0 }));
    await queue.enqueue(ingredientUpdateChange({ id: "g2", projectId: "p1", fields: { name: "B" }, now: T0 }));
    expect(await ids(queue)).toEqual(["ingredient:g1:update", "ingredient:g2:update"]);
  });

  it("folds an edit into the ingredient's own waiting create, and deleting it sends nothing", async () => {
    const { queue } = setup();
    await queue.enqueue(ingredientCreateChange({ id: "g1", projectId: "p1", name: "A", mode: "weight", purchase: P1, now: T0 }));
    await queue.enqueue(ingredientUpdateChange({ id: "g1", projectId: "p1", fields: { name: "B", purchase: P3 }, now: T1 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ kind: "create", data: { name: "B", purchase: P3, mode: "weight" } });
    await queue.enqueue(ingredientDeleteChange({ id: "g1", projectId: "p1" }));
    expect(await queue.waiting()).toEqual([]);
  });

  it("refuses to build a mode change without its purchase", () => {
    expect(() => ingredientUpdateChange({ id: "g1", projectId: "p1", fields: { mode: "volume" }, now: T0 })).toThrow();
  });
});

describe("sending ingredient changes", () => {
  it("creates with the whole purchase and isDefault", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(ingredientCreateChange({ id: "g1", projectId: "p1", name: "A", mode: "weight", purchase: P1, isDefault: true, now: T0 }));
    await queue.flush();
    expect(deps.createIngredient).toHaveBeenCalledWith("tok", "p1", { id: "g1", name: "A", mode: "weight", isDefault: true, purchase: P1 });
  });

  it("sends only the changed fields of an update, each with its own time, and mode with purchase together", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(ingredientUpdateChange({ id: "g1", projectId: "p1", fields: { name: "B" }, now: T0 }));
    await queue.enqueue(
      ingredientUpdateChange({ id: "g1", projectId: "p1", fields: { mode: "volume", purchase: { quantity: 1000, unit: "l", price: 9000 } }, now: T1 }),
    );
    await queue.flush();
    expect(deps.patchIngredient).toHaveBeenCalledTimes(1);
    expect(deps.patchIngredient).toHaveBeenCalledWith("tok", "p1", "g1", {
      name: { value: "B", editedAt: T0.toISOString() },
      mode: { value: "volume", editedAt: T1.toISOString() },
      purchase: { value: { quantity: 1000, unit: "l", price: 9000 }, editedAt: T1.toISOString() },
    });
  });

  it("deletes", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(ingredientDeleteChange({ id: "g2", projectId: "p1" }));
    await queue.flush();
    expect(deps.deleteIngredient).toHaveBeenCalledWith("tok", "p1", "g2");
  });
});
