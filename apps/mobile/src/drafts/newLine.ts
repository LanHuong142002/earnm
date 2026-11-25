import { per1, toBase, type IngredientUnit } from "../ingredients/cost";
import { parsePriceText, parseQuantityText } from "../ingredients/display";
import type { IngredientMode } from "../ingredients/types";
import { PRICE_MAX, QUANTITY_MAX_BASE } from "../ingredients/validate";
import type { Currency } from "../lib/currency";
import { lineCost } from "../products/cost";
import { parseAmount, type AmountError } from "../products/recipeEdit";
import { validateName, type NameError } from "../products/view";
import { DRAFT_NAME_MAX } from "./view";

/** The form of a new-ingredient recipe line (mockup A5), as typed. */
export type NewLineForm = {
  name: string;
  mode: IngredientMode;
  unit: IngredientUnit;
  qtyText: string;
  priceText: string;
  amountText: string;
};

const DEFAULT_UNIT: Record<IngredientMode, IngredientUnit> = { weight: "g", volume: "ml", portion: "portion" };

/** The unit a mode starts with (g, ml, portion). */
export const defaultUnitOf = (mode: IngredientMode): IngredientUnit => DEFAULT_UNIT[mode];

export function emptyNewLineForm(): NewLineForm {
  return { name: "", mode: "weight", unit: DEFAULT_UNIT.weight, qtyText: "", priceText: "", amountText: "" };
}

export type NewLineErrors = { name?: NameError; qty?: "invalid"; price?: "invalid"; amount?: AmountError };

export type NewLineValue = {
  newName: string;
  newKind: IngredientMode;
  purchaseQty: number | null;
  purchasePrice: number | null;
  amount: number;
};

/** Purchase quantity in base units; null when blank; `undefined` when typed but not usable. */
function readQty(form: NewLineForm): number | null | undefined {
  if (form.qtyText.trim() === "") return null;
  const typed = parseQuantityText(form.qtyText);
  if (typed === null || typed <= 0) return undefined;
  const base = toBase(typed, form.unit);
  return base > 0 && base <= QUANTITY_MAX_BASE ? base : undefined;
}

function readPrice(form: NewLineForm, currency: Currency): number | null | undefined {
  if (form.priceText.trim() === "") return null;
  const minor = parsePriceText(form.priceText, currency);
  if (minor === null || !Number.isInteger(minor) || minor <= 0 || minor > PRICE_MAX[currency]) return undefined;
  return minor;
}

/**
 * Checks the form. Quantity and price may stay empty (they are needed only before the draft is Done) but must be
 * usable when typed. `takenNames` are the project's ingredients and the draft's other new lines.
 */
export function parseNewLine(form: NewLineForm, currency: Currency, takenNames: readonly string[]): { ok: true; value: NewLineValue } | { ok: false; errors: NewLineErrors } {
  const errors: NewLineErrors = {};
  const name = validateName(form.name, takenNames, DRAFT_NAME_MAX);
  if (name) errors.name = name;
  const qty = readQty(form);
  if (qty === undefined) errors.qty = "invalid";
  const price = readPrice(form, currency);
  if (price === undefined) errors.price = "invalid";
  const amount = parseAmount(form.amountText);
  if (!amount.ok) errors.amount = amount.error;
  if (Object.keys(errors).length > 0 || qty === undefined || price === undefined || !amount.ok) return { ok: false, errors };
  return { ok: true, value: { newName: form.name.trim(), newKind: form.mode, purchaseQty: qty, purchasePrice: price, amount: amount.value } };
}

/** The result box of the form: the price of one base unit, the amount, and what they cost. Null until both are readable. */
export function lineCostText(form: NewLineForm, currency: Currency): { perUnit: number; amount: number; cost: number } | null {
  const qty = readQty(form);
  const price = readPrice(form, currency);
  const amount = parseAmount(form.amountText);
  if (qty === null || qty === undefined || price === null || price === undefined || !amount.ok) return null;
  const perUnit = per1(price, qty);
  if (perUnit === null) return null;
  return { perUnit, amount: amount.value, cost: lineCost({ purchase: { quantity: qty, price } }, amount.value) };
}
