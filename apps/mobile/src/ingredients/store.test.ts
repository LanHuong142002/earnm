import { describe, expect, it } from "vitest";

import { createMemoryStore } from "../sync/storage";
import { ingredient } from "./fixtures";
import {
  emptyIngredientCache,
  hasIngredients,
  ingredientsOf,
  isIngredient,
  loadIngredientCache,
  openIngredientCache,
  pruneIngredientCache,
  saveIngredientCache,
  setProjectIngredients,
  withIngredient,
  withoutIngredient,
} from "./store";

describe("ingredient cache", () => {
  it("accepts a real ingredient and rejects a malformed one", () => {
    expect(isIngredient(ingredient({ id: "g1" }))).toBe(true);
    expect(isIngredient({ ...ingredient({ id: "g1" }), mode: "mass" })).toBe(false);
    expect(isIngredient({ ...ingredient({ id: "g1" }), purchase: { quantity: "1", unit: "kg", price: 1 } })).toBe(false);
    expect(isIngredient({ ...ingredient({ id: "g1" }), prices: [{ nonsense: true }] })).toBe(false);
    expect(isIngredient(null)).toBe(false);
  });

  it("saves and loads per owner; another owner's copy is not read and is removed on open", async () => {
    const store = createMemoryStore();
    const cache = setProjectIngredients(emptyIngredientCache("u1"), "p1", [ingredient({ id: "g1" })]);
    await saveIngredientCache(store, cache);
    expect(ingredientsOf(await loadIngredientCache(store, "u1"), "p1")).toHaveLength(1);
    expect(hasIngredients(await loadIngredientCache(store, "u2"), "p1")).toBe(false);
    await openIngredientCache(store, "u2");
    expect(hasIngredients(await loadIngredientCache(store, "u1"), "p1")).toBe(false);
  });

  it("replaces or adds with withIngredient, removes with withoutIngredient, prunes projects", () => {
    const list = [ingredient({ id: "g1", name: "A" })];
    expect(withIngredient(list, ingredient({ id: "g1", name: "B" }))[0].name).toBe("B");
    expect(withIngredient(list, ingredient({ id: "g2" }))).toHaveLength(2);
    expect(withoutIngredient(list, "g1")).toEqual([]);
    const cache = setProjectIngredients(setProjectIngredients(emptyIngredientCache("u1"), "p1", list), "p2", list);
    expect(Object.keys(pruneIngredientCache(cache, ["p1"]).byProject)).toEqual(["p1"]);
  });
});
