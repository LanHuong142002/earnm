import type { Ingredient } from "./types";

/** An ingredient for tests; every field can be overridden. */
export function ingredient(overrides: Partial<Ingredient> & { id: string }): Ingredient {
  return {
    projectId: "p1",
    name: "Bột mì",
    mode: "weight",
    isDefault: false,
    purchase: { quantity: 1000, unit: "kg", price: 25000 },
    prices: [],
    createdAt: "2026-11-10T09:00:00.000Z",
    ...overrides,
  };
}
