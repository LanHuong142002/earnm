import type { Ingredient, IngredientMode } from "../ingredients/types";
import { lineCost, marginPct, profit } from "../products/cost";
import { buildDefaults } from "../products/defaults";
import type { ExtraCost } from "../products/types";

/** One recipe line of a draft, for one cup of the base size. Quantities are in base units (g, ml, portion). */
export type DraftLine =
  | { kind: "existing"; ingredientId: string; amount: number }
  | { kind: "new"; newName: string; newKind: IngredientMode; purchaseQty: number | null; purchasePrice: number | null; amount: number };

export type DraftEstimateInput = {
  lines: readonly DraftLine[];
  ingredients: readonly Ingredient[];
  extraCosts: readonly ExtraCost[];
  expectedPrice: number | null;
  targetMargin: number;
};

export type DraftEstimate = {
  recipeCost: number;
  defaultsCost: number;
  /** Null while any new line has no purchase price. */
  total: number | null;
  /** Names of the new lines that lack a purchase quantity or price. */
  missingPrices: string[];
  profit: number | null;
  marginPct: number | null;
};

const hasPurchase = (qty: number | null, price: number | null): qty is number => qty !== null && price !== null;

/** Cost of one line as a whole minor unit, or null for a new line without a purchase quantity and price. */
export function lineEstimate(line: DraftLine, ingredients: readonly Ingredient[]): number | null {
  if (line.kind === "new") {
    if (!hasPurchase(line.purchaseQty, line.purchasePrice)) return null;
    return lineCost({ purchase: { quantity: line.purchaseQty, price: line.purchasePrice as number } }, line.amount);
  }
  const found = ingredients.find((i) => i.id === line.ingredientId);
  return found ? lineCost(found, line.amount) : 0;
}

export function draftEstimate(input: DraftEstimateInput): DraftEstimate {
  const { lines, ingredients, extraCosts, expectedPrice } = input;
  let recipeCost = 0;
  const missingPrices: string[] = [];
  for (const line of lines) {
    const cost = lineEstimate(line, ingredients);
    if (cost === null) missingPrices.push((line as Extract<DraftLine, { kind: "new" }>).newName);
    else recipeCost += cost;
  }

  const defaults = buildDefaults("draft", "base", ingredients, extraCosts);
  let defaultsCost = 0;
  for (const l of defaults.lines) {
    const found = ingredients.find((i) => i.id === l.ingredientId);
    if (found) defaultsCost += lineCost(found, l.amount);
  }
  for (const x of defaults.extras) defaultsCost += x.amount;

  if (missingPrices.length > 0) return { recipeCost, defaultsCost, total: null, missingPrices, profit: null, marginPct: null };
  const total = recipeCost + defaultsCost;
  const p = profit(expectedPrice, total);
  return { recipeCost, defaultsCost, total, missingPrices, profit: p, marginPct: p === null ? null : marginPct(p, expectedPrice) };
}

export type DoneMissing =
  | { code: "name" | "sizes" | "lines" }
  | { code: "newLineQty" | "newLinePrice"; name: string };

/** What a draft still lacks before it can be marked done (R5), in a fixed order. */
export function missingForDone(draft: { name: string; sizes: readonly string[]; lines: readonly DraftLine[] }): DoneMissing[] {
  const out: DoneMissing[] = [];
  if (draft.name.trim() === "") out.push({ code: "name" });
  if (draft.sizes.length === 0) out.push({ code: "sizes" });
  if (draft.lines.length === 0) out.push({ code: "lines" });
  for (const line of draft.lines) {
    if (line.kind !== "new") continue;
    if (line.purchaseQty === null) out.push({ code: "newLineQty", name: line.newName });
    if (line.purchasePrice === null) out.push({ code: "newLinePrice", name: line.newName });
  }
  return out;
}
