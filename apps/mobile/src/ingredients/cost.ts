export type IngredientUnit = "kg" | "g" | "l" | "ml" | "portion";

// Quantities carry up to 3 decimals, so work in thousandths (integers) to avoid float drift.
function thousandths(value: number): number {
  return Math.round(value * 1000);
}

// kg -> g and l -> ml; g, ml and portion are already base units.
export function toBase(quantity: number, unit: IngredientUnit): number {
  const t = thousandths(quantity);
  return unit === "kg" || unit === "l" ? t : t / 1000;
}

function usable(price: number, base: number): boolean {
  return Number.isFinite(price) && Number.isFinite(base) && base > 0;
}

// Minor units per 1 base unit, unrounded.
export function unitCost(price: number, base: number): number | null {
  return usable(price, base) ? price / base : null;
}

// Per 1 base unit, rounded to 2 decimals of the minor unit.
export function per1(price: number, base: number): number | null {
  return usable(price, base) ? Math.round((price * 100) / base) / 100 : null;
}

// Per 10 base units, rounded to a whole minor unit.
export function per10(price: number, base: number): number | null {
  return usable(price, base) ? Math.round((price * 10) / base) : null;
}

export function totalSpent(ingredients: ReadonlyArray<{ price: number }>): number {
  return ingredients.reduce((sum, i) => sum + i.price, 0);
}
