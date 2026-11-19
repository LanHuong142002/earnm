import { describe, expect, it } from "vitest";

import { createMemoryStore } from "../sync/storage";
import { extraCost, product } from "./fixtures";
import {
  clearProductCache,
  emptyProductCache,
  extraCostsOf,
  hasProducts,
  isExtraCost,
  isProduct,
  loadProductCache,
  openProductCache,
  productsOf,
  pruneProductCache,
  saveProductCache,
  setProjectProducts,
  withExtraCost,
  withProduct,
  withoutExtraCost,
  withoutProduct,
} from "./store";

describe("product cache", () => {
  it("saves and loads per owner; another owner's copy reads as empty and is removed on open", async () => {
    const store = createMemoryStore();
    const cache = setProjectProducts(emptyProductCache("u1"), "p1", { products: [product({ id: "pr1" })], extraCosts: [extraCost({ id: "x1" })] });
    await saveProductCache(store, cache);
    expect(await loadProductCache(store, "u1")).toEqual(cache);
    expect(await loadProductCache(store, "u2")).toEqual(emptyProductCache("u2"));
    expect(await openProductCache(store, "u2")).toEqual(emptyProductCache("u2"));
    expect(await loadProductCache(store, "u1")).toEqual(emptyProductCache("u1"));
  });

  it("drops only the project whose copy is malformed", async () => {
    const store = createMemoryStore();
    await store.setJSON("products.cache.v1", {
      ownerId: "u1",
      byProject: { p1: { products: [{ id: 1 }], extraCosts: [] }, p2: { products: [product({ id: "pr1", projectId: "p2" })], extraCosts: [] } },
    });
    const cache = await loadProductCache(store, "u1");
    expect(hasProducts(cache, "p1")).toBe(false);
    expect(productsOf(cache, "p2")).toHaveLength(1);
  });

  it("clears", async () => {
    const store = createMemoryStore();
    await saveProductCache(store, emptyProductCache("u1"));
    await clearProductCache(store);
    expect(await store.getJSON("products.cache.v1")).toBeNull();
  });

  it("reads empty lists for a project never fetched", () => {
    const c = emptyProductCache("u1");
    expect(productsOf(c, "p1")).toEqual([]);
    expect(extraCostsOf(c, "p1")).toEqual([]);
    expect(hasProducts(c, "p1")).toBe(false);
  });

  it("replaces, adds and removes by id; prunes projects that are gone", () => {
    const a = product({ id: "a", name: "A" });
    expect(withProduct([a], product({ id: "a", name: "A2" }))[0].name).toBe("A2");
    expect(withProduct([a], product({ id: "b" })).map((p) => p.id)).toEqual(["a", "b"]);
    expect(withoutProduct([a], "a")).toEqual([]);
    const x = extraCost({ id: "x" });
    expect(withExtraCost([x], extraCost({ id: "x", amount: 1 }))[0].amount).toBe(1);
    expect(withoutExtraCost([x], "x")).toEqual([]);
    const c = setProjectProducts(setProjectProducts(emptyProductCache("u"), "p1", { products: [], extraCosts: [] }), "p2", { products: [], extraCosts: [] });
    expect(Object.keys(pruneProductCache(c, ["p2"]).byProject)).toEqual(["p2"]);
  });

  it("recognises well-formed server items only", () => {
    expect(isProduct(product({ id: "a" }))).toBe(true);
    expect(isProduct({ ...product({ id: "a" }), sizes: [{ size: "XL", sellingPrice: null, lines: [], extras: [] }] })).toBe(false);
    expect(isProduct({ id: "a" })).toBe(false);
    expect(isExtraCost(extraCost({ id: "x" }))).toBe(true);
    expect(isExtraCost({ id: "x", name: 1 })).toBe(false);
  });
});
