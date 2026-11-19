import { parseQuantityText } from "../ingredients/display";
import { localExtraId } from "./defaults";
import type { ExtraCost, ProductSize, SizeName, SizeRecipe } from "./types";

export const AMOUNT_MAX = 100_000;
export const MONEY_MAX = 1_000_000_000;

export type AmountError = "invalid" | "zero" | "tooLarge" | "decimals";

/** A recipe amount typed as text: at most 3 decimals, greater than 0 (a default line may stay 0) and at most 100.000 (spec R4). */
export function parseAmount(
  text: string,
  { allowZero = false }: { allowZero?: boolean } = {},
): { ok: true; value: number } | { ok: false; error: AmountError } {
  const value = parseQuantityText(text);
  if (value === null) return { ok: false, error: "invalid" };
  if (Math.round(value * 1000) / 1000 !== value) return { ok: false, error: "decimals" };
  if (value === 0 && !allowZero) return { ok: false, error: "zero" };
  if (value > AMOUNT_MAX) return { ok: false, error: "tooLarge" };
  return { ok: true, value };
}

/** An extra cost or selling price in minor units: a whole number from 0 to 1.000.000.000. */
export function validMoney(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 0 && value <= MONEY_MAX;
}

/** The part of a size the person edits, in the shape `setLines` takes. */
export function recipeOf(size: ProductSize): SizeRecipe {
  return {
    lines: size.lines.map(({ ingredientId, amount, included }) => ({ ingredientId, amount, included })),
    extras: size.extras.map(({ id, name, amount, included, isDefault, extraCostId }) => ({ id, name, amount, included, isDefault, extraCostId })),
  };
}

export function setLineAmount(recipe: SizeRecipe, ingredientId: string, amount: number): SizeRecipe {
  return { ...recipe, lines: recipe.lines.map((l) => (l.ingredientId === ingredientId ? { ...l, amount } : l)) };
}

export function toggleLine(recipe: SizeRecipe, ingredientId: string): SizeRecipe {
  return { ...recipe, lines: recipe.lines.map((l) => (l.ingredientId === ingredientId ? { ...l, included: !l.included } : l)) };
}

export function removeLine(recipe: SizeRecipe, ingredientId: string): SizeRecipe {
  return { ...recipe, lines: recipe.lines.filter((l) => l.ingredientId !== ingredientId) };
}

/** Adds a ticked line; an ingredient already in the size is left alone (it appears once per size). */
export function addLine(recipe: SizeRecipe, ingredientId: string, amount: number): SizeRecipe {
  if (recipe.lines.some((l) => l.ingredientId === ingredientId)) return recipe;
  return { ...recipe, lines: [...recipe.lines, { ingredientId, amount, included: true }] };
}

export function setExtraAmount(recipe: SizeRecipe, extraId: string, amount: number): SizeRecipe {
  return { ...recipe, extras: recipe.extras.map((x) => (x.id === extraId ? { ...x, amount } : x)) };
}

export function toggleExtra(recipe: SizeRecipe, extraId: string): SizeRecipe {
  return { ...recipe, extras: recipe.extras.map((x) => (x.id === extraId ? { ...x, included: !x.included } : x)) };
}

export function removeExtra(recipe: SizeRecipe, extraId: string): SizeRecipe {
  return { ...recipe, extras: recipe.extras.filter((x) => x.id !== extraId) };
}

/** Copies a project extra cost into the size, ticked (not a default copy). Already copied ones are left alone. */
export function addExtra(recipe: SizeRecipe, productId: string, size: SizeName, extraCost: ExtraCost): SizeRecipe {
  if (recipe.extras.some((x) => x.extraCostId === extraCost.id)) return recipe;
  return {
    ...recipe,
    extras: [
      ...recipe.extras,
      { id: localExtraId(productId, size, extraCost.id), name: extraCost.name, amount: extraCost.amount, included: true, isDefault: false, extraCostId: extraCost.id },
    ],
  };
}

/** Project extra costs not yet in the size, in list order. */
export function extrasToAdd(recipe: SizeRecipe, extraCosts: readonly ExtraCost[]): ExtraCost[] {
  const used = new Set(recipe.extras.map((x) => x.extraCostId).filter((id): id is string => id !== null));
  return extraCosts.filter((x) => !used.has(x.id));
}
