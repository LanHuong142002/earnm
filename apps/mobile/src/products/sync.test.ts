import { describe, expect, it, vi } from "vitest";

import { createQueue, type Change, type Queue } from "../sync/queue";
import { createMemoryStore } from "../sync/storage";
import { extraCost, fixedCost, product } from "./fixtures";
import {
  fixedCostCreateChange,
  fixedCostDeleteChange,
  fixedCostUpdateChange,
  extraCostCreateChange,
  extraCostDeleteChange,
  extraCostUpdateChange,
  productCreateChange,
  productDeleteChange,
  productLinesChange,
  productPriceChange,
  productUpdateChange,
  registerProductEntities,
} from "./sync";

const T0 = new Date("2026-11-18T09:00:00.000Z");
const T1 = new Date("2026-11-18T09:01:00.000Z");
const T2 = new Date("2026-11-18T09:02:00.000Z");
const U = "11111111-1111-4111-8111-111111111111";

const newQueue = () =>
  createQueue({ store: createMemoryStore(), getToken: async () => "tok", onApplied: () => {}, onRejected: () => {}, onSignedOut: () => {} });

function setup() {
  const applied: Change[] = [];
  const rejected: Change[] = [];
  const queue = newQueue();
  const deps = {
    createProduct: vi.fn(async (_t: string, _p: string, b: { id: string }) => product({ id: b.id })),
    patchProduct: vi.fn(async (_t: string, _p: string, id: string) => product({ id })),
    putSizePrice: vi.fn(async (_t: string, _p: string, id: string) => product({ id })),
    putSizeLines: vi.fn(async (_t: string, _p: string, id: string, _s: string, _b: unknown) => product({ id })),
    deleteProduct: vi.fn(async () => undefined),
    createExtraCost: vi.fn(async (_t: string, _p: string, b: { id: string }) => extraCost({ id: b.id })),
    patchExtraCost: vi.fn(async (_t: string, _p: string, id: string) => extraCost({ id })),
    deleteExtraCost: vi.fn(async () => undefined),
    createFixedCost: vi.fn(async (_t: string, _p: string, b: { id: string }) => fixedCost({ id: b.id })),
    patchFixedCost: vi.fn(async (_t: string, _p: string, id: string, _f: unknown) => fixedCost({ id })),
    deleteFixedCost: vi.fn(async () => undefined),
  };
  registerProductEntities(queue, { onApplied: (c) => void applied.push(c), onRejected: (c) => void rejected.push(c) }, deps);
  return { queue, deps, applied, rejected };
}

const ids = async (queue: Queue) => (await queue.waiting()).map((c) => `${c.entity}:${c.entityId}:${c.kind}`);
const recipe = (amount: number) => ({ lines: [{ ingredientId: "g1", amount, included: true }], extras: [] });

describe("queued product changes merge per field (spec AC14)", () => {
  it("merges edits of one product into one change, field by field, each with its own time", async () => {
    const { queue } = setup();
    await queue.enqueue(productUpdateChange({ id: "pr1", projectId: "p1", fields: { name: "A" }, now: T0 }));
    await queue.enqueue(productUpdateChange({ id: "pr1", projectId: "p1", fields: { name: "B", sizes: ["S", "M"], defaults: {} }, now: T1 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data).toMatchObject({ name: "B", sizes: ["S", "M"] });
    expect(waiting[0].fieldTimes).toMatchObject({ name: T1.toISOString(), sizes: T1.toISOString() });
  });

  it("folds an edit made while the create waits into the create", async () => {
    const { queue } = setup();
    await queue.enqueue(productCreateChange({ id: "pr1", projectId: "p1", name: "A", sizes: ["M"], defaults: {}, now: T0 }));
    await queue.enqueue(productUpdateChange({ id: "pr1", projectId: "p1", fields: { name: "B" }, now: T1 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ kind: "create", data: { name: "B" } });
  });

  it("keeps the last price of a size and keeps sizes apart", async () => {
    const { queue } = setup();
    await queue.enqueue(productPriceChange({ productId: "pr1", projectId: "p1", size: "M", value: 30000, now: T0 }));
    await queue.enqueue(productPriceChange({ productId: "pr1", projectId: "p1", size: "M", value: null, now: T1 }));
    await queue.enqueue(productPriceChange({ productId: "pr1", projectId: "p1", size: "L", value: 40000, now: T1 }));
    const waiting = await queue.waiting();
    expect(await ids(queue)).toEqual(["productPrice:pr1|M:update", "productPrice:pr1|L:update"]);
    expect(waiting[0].data.value).toBeNull();
    expect(waiting[0].fieldTimes.value).toBe(T1.toISOString());
  });

  it("keeps a size's recipe as one whole field: a later one replaces it", async () => {
    const { queue } = setup();
    await queue.enqueue(productLinesChange({ productId: "pr1", projectId: "p1", size: "M", recipe: recipe(1), now: T0 }));
    await queue.enqueue(productLinesChange({ productId: "pr1", projectId: "p1", size: "M", recipe: recipe(7), now: T1 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data.recipe).toEqual(recipe(7));
  });

  it("an older edit never overwrites a newer one", async () => {
    const { queue } = setup();
    await queue.enqueue(productPriceChange({ productId: "pr1", projectId: "p1", size: "M", value: 2, now: T2 }));
    await queue.enqueue(productPriceChange({ productId: "pr1", projectId: "p1", size: "M", value: 1, now: T0 }));
    expect((await queue.waiting())[0].data.value).toBe(2);
  });

  it("merges extra cost edits per field", async () => {
    const { queue } = setup();
    await queue.enqueue(extraCostUpdateChange({ id: "x1", projectId: "p1", fields: { name: "A" }, now: T0 }));
    await queue.enqueue(extraCostUpdateChange({ id: "x1", projectId: "p1", fields: { amount: 900, isDefault: true }, now: T1 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data).toMatchObject({ name: "A", amount: 900, isDefault: true });
  });

  it("deleting a product that was never sent removes its create", async () => {
    const { queue } = setup();
    await queue.enqueue(productCreateChange({ id: "pr1", projectId: "p1", name: "A", sizes: ["M"], defaults: {}, now: T0 }));
    await queue.enqueue(productDeleteChange({ id: "pr1", projectId: "p1" }));
    expect(await ids(queue)).toEqual([]);
  });
});

describe("sending product changes", () => {
  it("sends a create, an update with a time per field, a price, a recipe and a delete", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(productCreateChange({ id: "pr1", projectId: "p1", name: "A", sizes: ["S", "M"], defaults: {}, now: T0 }));
    await queue.enqueue(productPriceChange({ productId: "pr1", projectId: "p1", size: "M", value: 30000, now: T1 }));
    await queue.enqueue(
      productLinesChange({
        productId: "pr1",
        projectId: "p1",
        size: "M",
        recipe: {
          lines: [{ ingredientId: "g1", amount: 2, included: true }],
          extras: [
            { id: "local:pr1:M:x1", name: "Đá", amount: 500, included: true, isDefault: true, extraCostId: "x1" },
            { id: U, name: "Nước", amount: 100, included: false, isDefault: false, extraCostId: null },
          ],
        },
        now: T2,
      }),
    );
    await queue.enqueue(productUpdateChange({ id: "pr2", projectId: "p1", fields: { name: "Z" }, now: T2 }));
    await queue.enqueue(productDeleteChange({ id: "pr3", projectId: "p1" }));
    await queue.flush();
    expect(deps.createProduct).toHaveBeenCalledWith("tok", "p1", { id: "pr1", name: "A", sizes: ["S", "M"] });
    expect(deps.putSizePrice).toHaveBeenCalledWith("tok", "p1", "pr1", "M", { value: 30000, editedAt: T1.toISOString() });
    // A local (non-uuid) extra id is left out so the server makes one; a real one is kept.
    expect(deps.putSizeLines).toHaveBeenCalledWith("tok", "p1", "pr1", "M", {
      editedAt: T2.toISOString(),
      value: {
        lines: [{ ingredientId: "g1", amount: 2, included: true }],
        extras: [
          { name: "Đá", amount: 500, included: true, isDefault: true, extraCostId: "x1" },
          { id: U, name: "Nước", amount: 100, included: false, isDefault: false, extraCostId: null },
        ],
      },
    });
    expect(deps.patchProduct).toHaveBeenCalledWith("tok", "p1", "pr2", { name: { value: "Z", editedAt: T2.toISOString() } });
    expect(deps.deleteProduct).toHaveBeenCalledWith("tok", "p1", "pr3");
  });

  it("sends extra cost create, update and delete", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(extraCostCreateChange({ id: "x1", projectId: "p1", name: "Đá", amount: 500, isDefault: true, now: T0 }));
    await queue.enqueue(extraCostUpdateChange({ id: "x2", projectId: "p1", fields: { amount: 700 }, now: T1 }));
    await queue.enqueue(extraCostDeleteChange({ id: "x3", projectId: "p1" }));
    await queue.flush();
    expect(deps.createExtraCost).toHaveBeenCalledWith("tok", "p1", { id: "x1", name: "Đá", amount: 500, isDefault: true });
    expect(deps.patchExtraCost).toHaveBeenCalledWith("tok", "p1", "x2", { amount: { value: 700, editedAt: T1.toISOString() } });
    expect(deps.deleteExtraCost).toHaveBeenCalledWith("tok", "p1", "x3");
  });

  it("sends in the order the changes were queued, so ingredient changes queued first go first", async () => {
    const sent: string[] = [];
    const queue = newQueue();
    queue.registerEntity("ingredient", { create: async () => void sent.push("ingredient"), update: async () => {}, delete: async () => {} });
    registerProductEntities(queue, {}, {
      createProduct: async () => void sent.push("product"),
      patchProduct: async () => {},
      putSizePrice: async () => {},
      putSizeLines: async () => {},
      deleteProduct: async () => {},
      createExtraCost: async () => {},
      patchExtraCost: async () => {},
      deleteExtraCost: async () => {},
    } as never);
    await queue.enqueue({ entity: "ingredient", entityId: "g1", kind: "create", data: { projectId: "p1" } });
    await queue.enqueue(productCreateChange({ id: "pr1", projectId: "p1", name: "A", sizes: ["M"], defaults: {}, now: T0 }));
    await queue.flush();
    expect(sent).toEqual(["ingredient", "product"]);
  });
});

describe("queued fixed cost changes (spec R8, AC9)", () => {
  it("merges edits per field, each with its own time, including months", async () => {
    const { queue } = setup();
    await queue.enqueue(fixedCostUpdateChange({ id: "f1", projectId: "p1", fields: { name: "A" }, now: T0 }));
    await queue.enqueue(fixedCostUpdateChange({ id: "f1", projectId: "p1", fields: { amount: 900, kind: "oneTime", months: 12 }, now: T1 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data).toMatchObject({ name: "A", amount: 900, kind: "oneTime", months: 12 });
    expect(waiting[0].fieldTimes).toMatchObject({ name: T0.toISOString(), amount: T1.toISOString() });
  });

  it("an edit of a cost still waiting to be created folds into the create", async () => {
    const { queue } = setup();
    await queue.enqueue(fixedCostCreateChange({ id: "f1", projectId: "p1", name: "A", kind: "monthly", amount: 100, months: null, now: T0 }));
    await queue.enqueue(fixedCostUpdateChange({ id: "f1", projectId: "p1", fields: { amount: 200 }, now: T1 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ kind: "create", data: { name: "A", amount: 200 } });
  });

  it("deleting a cost that was never sent removes its create", async () => {
    const { queue } = setup();
    await queue.enqueue(fixedCostCreateChange({ id: "f1", projectId: "p1", name: "A", kind: "monthly", amount: 100, months: null, now: T0 }));
    await queue.enqueue(fixedCostDeleteChange({ id: "f1", projectId: "p1" }));
    expect(await ids(queue)).toEqual([]);
  });

  it("sends create, update and delete", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(fixedCostCreateChange({ id: "f1", projectId: "p1", name: "Máy", kind: "oneTime", amount: 18000000, months: 24, now: T0 }));
    await queue.enqueue(fixedCostCreateChange({ id: "f4", projectId: "p1", name: "Thuê", kind: "monthly", amount: 5000000, months: null, now: T0 }));
    await queue.enqueue(fixedCostUpdateChange({ id: "f2", projectId: "p1", fields: { amount: 700 }, now: T1 }));
    await queue.enqueue(fixedCostDeleteChange({ id: "f3", projectId: "p1" }));
    await queue.flush();
    expect(deps.createFixedCost).toHaveBeenCalledWith("tok", "p1", { id: "f1", name: "Máy", kind: "oneTime", amount: 18000000, months: 24 });
    expect(deps.createFixedCost).toHaveBeenCalledWith("tok", "p1", { id: "f4", name: "Thuê", kind: "monthly", amount: 5000000, months: null });
    expect(deps.patchFixedCost).toHaveBeenCalledWith("tok", "p1", "f2", { amount: { value: 700, editedAt: T1.toISOString() } });
    expect(deps.deleteFixedCost).toHaveBeenCalledWith("tok", "p1", "f3");
  });

  it("does not send months along with a kind that is not one-time (a merged edit may carry stale months)", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(fixedCostUpdateChange({ id: "f1", projectId: "p1", fields: { kind: "oneTime", months: 6 }, now: T0 }));
    await queue.enqueue(fixedCostUpdateChange({ id: "f1", projectId: "p1", fields: { kind: "monthly" }, now: T1 }));
    await queue.flush();
    expect(deps.patchFixedCost).toHaveBeenCalledWith("tok", "p1", "f1", { kind: { value: "monthly", editedAt: T1.toISOString() } });
  });
});
