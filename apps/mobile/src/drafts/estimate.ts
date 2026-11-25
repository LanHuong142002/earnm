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
  /** Null while any new line has no purchase price or any existing line has lost its ingredient. */
  total: number | null;
  /** Names of the new lines that lack a purchase quantity or price. */
  missingPrices: string[];
  /** How many existing lines point at an ingredient that no longer exists. */
  missingIngredients: number;
  profit: number | null;
  marginPct: number | null;
};

const nameKey = (name: string) => name.trim().toLocaleLowerCase("vi");

const hasPurchase = (qty: number | null, price: number | null): qty is number => qty !== null && price !== null;

/** Cost of one line as a whole minor unit, or null for a new line without a purchase quantity and price, or an existing line whose ingredient is gone. */
export function lineEstimate(line: DraftLine, ingredients: readonly Ingredient[]): number | null {
  if (line.kind === "new") {
    if (!hasPurchase(line.purchaseQty, line.purchasePrice)) return null;
    return lineCost({ purchase: { quantity: line.purchaseQty, price: line.purchasePrice as number } }, line.amount);
  }
  const found = ingredients.find((i) => i.id === line.ingredientId);
  return found ? lineCost(found, line.amount) : null;
}

export function draftEstimate(input: DraftEstimateInput): DraftEstimate {
  const { lines, ingredients, extraCosts, expectedPrice } = input;
  let recipeCost = 0;
  const missingPrices: string[] = [];
  let missingIngredients = 0;
  for (const line of lines) {
    const cost = lineEstimate(line, ingredients);
    if (cost !== null) recipeCost += cost;
    else if (line.kind === "new") missingPrices.push(line.newName);
    else missingIngredients += 1;
  }

  // A default the draft already has as a line is replaced by the draft's amount when converted, so it counts once.
  const usedIds = new Set(lines.flatMap((l) => (l.kind === "existing" ? [l.ingredientId] : [])));
  const usedNames = new Set(lines.flatMap((l) => (l.kind === "new" ? [nameKey(l.newName)] : [])));

  const defaults = buildDefaults("draft", "base", ingredients, extraCosts);
  let defaultsCost = 0;
  for (const l of defaults.lines) {
    const found = ingredients.find((i) => i.id === l.ingredientId);
    if (found && !usedIds.has(found.id) && !usedNames.has(nameKey(found.name))) defaultsCost += lineCost(found, l.amount);
  }
  for (const x of defaults.extras) defaultsCost += x.amount;

  if (missingPrices.length > 0 || missingIngredients > 0) return { recipeCost, defaultsCost, total: null, missingPrices, missingIngredients, profit: null, marginPct: null };
  const total = recipeCost + defaultsCost;
  const p = profit(expectedPrice, total);
  return { recipeCost, defaultsCost, total, missingPrices, missingIngredients, profit: p, marginPct: p === null ? null : marginPct(p, expectedPrice) };
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
