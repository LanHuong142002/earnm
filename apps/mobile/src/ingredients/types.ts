import type { IngredientUnit } from "./cost";

export const INGREDIENT_MODES = ["weight", "volume", "portion"] as const;
export type IngredientMode = (typeof INGREDIENT_MODES)[number];

/** What was bought: `quantity` in base units (g, ml, portion), `unit` the unit to show it in, `price` in minor units. */
export type Purchase = { quantity: number; unit: IngredientUnit; price: number };

export type IngredientAuthor = { id: string; displayName: string };

/** One recorded purchase, newest first, at most 5 per ingredient. */
export type PriceEntry = Purchase & { id: string; author: IngredientAuthor | null; recordedAt: string };

/** An ingredient exactly as the API returns it (spec R9, R17). */
export type Ingredient = {
  id: string;
  projectId: string;
  name: string;
  mode: IngredientMode;
  isDefault: boolean;
  purchase: Purchase;
  prices: PriceEntry[];
  createdAt: string;
};
