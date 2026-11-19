import type { Ingredient } from "../ingredients/types";
import type { ExtraCost, ProductExtra, ProductLine } from "./types";

/** What a new size starts with, built from the project's defaults the same way the server does. */
export type SizeDefaults = { lines: ProductLine[]; extras: ProductExtra[] };

/** Local id of a default extra before the server gives it one. Not a uuid, so it is never sent as one. */
export const localExtraId = (productId: string, size: string, extraCostId: string) => `local:${productId}:${size}:${extraCostId}`;

const byCreated = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** A ticked line per default ingredient (portion starts at 1, weight and volume at 0) and a copy of each default extra cost. */
export function buildDefaults(productId: string, size: string, ingredients: readonly Ingredient[], extraCosts: readonly ExtraCost[]): SizeDefaults {
  return {
    lines: ingredients
      .filter((i) => i.isDefault)
      .sort(byCreated)
      .map((i) => ({ ingredientId: i.id, amount: i.mode === "portion" ? 1 : 0, included: true, isDefault: true })),
    extras: extraCosts
      .filter((x) => x.isDefault)
      .sort(byCreated)
      .map((x) => ({
        id: localExtraId(productId, size, x.id),
        name: x.name,
        amount: x.amount,
        included: true,
        isDefault: true,
        extraCostId: x.id,
      })),
  };
}
