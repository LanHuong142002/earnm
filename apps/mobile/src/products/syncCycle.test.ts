import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import type { Change } from "../sync/queue";
import { extraCost, product } from "./fixtures";
import { createProductSyncCycle, productReasonFor, type ProductRejectedNotice } from "./syncCycle";
import type { ProjectProducts } from "./store";

const change = (over: Partial<Change> = {}): Change => ({
  changeId: "c1",
  entity: "product",
  entityId: "pr1",
  kind: "update",
  data: { projectId: "p1" },
  fieldTimes: {},
  createdAt: "2026-11-18T09:00:00.000Z",
  ...over,
});

function setup(initial: Record<string, ProjectProducts> = { p1: { products: [product({ id: "pr1", name: "Cũ" })], extraCosts: [extraCost({ id: "x1", name: "Đá" })] } }) {
  let entries = initial;
  let generation = 0;
  const notices: ProductRejectedNotice[] = [];
  const deps = {
    getToken: vi.fn(async () => "tok" as string | null),
    listProducts: vi.fn(async () => [product({ id: "pr1", name: "Từ máy chủ" })]),
    listExtraCosts: vi.fn(async () => [extraCost({ id: "x1", name: "Từ máy chủ" })]),
    getEntry: (projectId: string) => entries[projectId] ?? null,
    commit: async (projectId: string, entry: ProjectProducts) => {
      entries = { ...entries, [projectId]: entry };
    },
    setNotice: (n: ProductRejectedNotice) => void notices.push(n),
    getGeneration: () => generation,
    isWiped: () => false,
    onNotSignedIn: vi.fn(),
  };
  const cycle = createProductSyncCycle(deps);
  return { cycle, deps, notices, get: () => entries, bump: () => void generation++ };
}

describe("product sync cycle", () => {
  it("replaces the cached product with the server's reply, whichever change made it", async () => {
    const s = setup();
    s.cycle.handlers.onApplied(change({ entity: "productPrice", entityId: "pr1|M" }), product({ id: "pr1", name: "Mới" }));
    await s.cycle.idle();
    expect(s.get().p1.products).toMatchObject([{ id: "pr1", name: "Mới" }]);
  });

  it("adds a created product, removes a deleted one, in both lists", async () => {
    const s = setup();
    s.cycle.handlers.onApplied(change({ kind: "create", entityId: "pr2" }), product({ id: "pr2" }));
    s.cycle.handlers.onApplied(change({ kind: "delete" }), undefined);
    s.cycle.handlers.onApplied(change({ entity: "extraCost", entityId: "x2", kind: "create" }), extraCost({ id: "x2" }));
    s.cycle.handlers.onApplied(change({ entity: "extraCost", entityId: "x1", kind: "delete" }), undefined);
    await s.cycle.idle();
    expect(s.get().p1.products.map((p) => p.id)).toEqual(["pr2"]);
    expect(s.get().p1.extraCosts.map((x) => x.id)).toEqual(["x2"]);
  });

  it("a malformed reply leaves the cache alone and fetches the project again", async () => {
    const s = setup();
    s.cycle.handlers.onApplied(change(), { nonsense: true });
    await s.cycle.idle();
    expect(s.get().p1.products[0].name).toBe("Cũ");
    await s.cycle.refreshPending();
    expect(s.get().p1.products[0].name).toBe("Từ máy chủ");
    expect(s.get().p1.extraCosts[0].name).toBe("Từ máy chủ");
  });

  it("a reply for a project that was never fetched does not make a one-item list", async () => {
    const s = setup({});
    s.cycle.handlers.onApplied(change({ kind: "create" }), product({ id: "pr1" }));
    await s.cycle.idle();
    expect(s.get().p1).toBeUndefined();
  });

  it("a refused change sets the notice with the product's name and fetches the project again", async () => {
    const s = setup();
    s.cycle.handlers.onRejected(change({ entity: "productPrice", entityId: "pr1|M", data: { projectId: "p1", productId: "pr1" } }), new ApiError("product_name_taken", 409));
    await s.cycle.idle();
    expect(s.notices).toEqual([{ entity: "product", kind: "update", name: "Cũ", reason: "nameTaken" }]);
    await s.cycle.refreshPending();
    expect(s.get().p1.products[0].name).toBe("Từ máy chủ");
  });

  it("names a refused extra cost, and a refused create from the change itself", async () => {
    const s = setup();
    s.cycle.handlers.onRejected(change({ entity: "extraCost", entityId: "x1", kind: "delete" }), new ApiError("not_found", 404));
    s.cycle.handlers.onRejected(change({ kind: "create", entityId: "pr9", data: { projectId: "p1", name: "Mới" } }), new ApiError("product_limit_reached", 409));
    await s.cycle.idle();
    expect(s.notices).toEqual([
      { entity: "extraCost", kind: "delete", name: "Đá", reason: "not_found" },
      { entity: "product", kind: "create", name: "Mới", reason: "limit" },
    ]);
  });

  it("maps the server's codes to reasons", () => {
    expect(productReasonFor(new ApiError("product_name_taken", 409))).toBe("nameTaken");
    expect(productReasonFor(new ApiError("product_limit_reached", 409))).toBe("limit");
    expect(productReasonFor(new ApiError("extra_cost_limit_reached", 409))).toBe("limit");
    expect(productReasonFor(new ApiError("id_conflict", 409))).toBe("conflict");
    expect(productReasonFor(new ApiError("validation_failed", 400))).toBe("invalid");
    expect(productReasonFor(new ApiError("oops", 500))).toBe("generic");
  });

  it("refresh saves both lists; offline and errors keep the cache; 404 empties the project", async () => {
    const s = setup();
    expect(await s.cycle.refresh("p1")).toBe("ok");
    expect(s.get().p1.products[0].name).toBe("Từ máy chủ");
    s.deps.listProducts.mockRejectedValueOnce(new ApiError("network"));
    expect(await s.cycle.refresh("p1")).toBe("offline");
    s.deps.listProducts.mockRejectedValueOnce(new ApiError("internal_error", 500));
    expect(await s.cycle.refresh("p1")).toBe("error");
    s.deps.listExtraCosts.mockRejectedValueOnce(new ApiError("not_found", 404));
    expect(await s.cycle.refresh("p1")).toBe("gone");
    expect(s.get().p1).toEqual({ products: [], extraCosts: [] });
  });

  it("drops a result that arrives after the session changed, and reports not signed in", async () => {
    const s = setup();
    s.deps.listProducts.mockImplementationOnce(async () => {
      s.bump();
      return [];
    });
    expect(await s.cycle.refresh("p1")).toBe("skipped");
    expect(s.get().p1.products[0].name).toBe("Cũ");
    s.deps.listProducts.mockRejectedValueOnce(new ApiError("not_signed_in", 401));
    await s.cycle.refresh("p1");
    expect(s.deps.onNotSignedIn).toHaveBeenCalled();
  });
});
