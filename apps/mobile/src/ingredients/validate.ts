import type { Currency } from "../lib/currency";
import { toBase, type IngredientUnit } from "./cost";

export const NAME_MAX = 60;
export const QUANTITY_MAX_BASE = 1_000_000;
// Minor units: 1.000.000.000 dong; $100.000 = 10.000.000 cents.
export const PRICE_MAX: Record<Currency, number> = { VND: 1_000_000_000, USD: 10_000_000 };

export type IngredientForm = {
  name: string;
  quantity: number | null;
  unit: IngredientUnit;
  price: number | null;
};

export type IngredientErrors = {
  name?: string;
  quantity?: string;
  price?: string;
};

const key = (k: string) => `ingredients.errors.${k}`;
const norm = (s: string) => s.trim().toLowerCase();

export function validateIngredient(
  form: IngredientForm,
  existingNames: readonly string[],
  currency: Currency,
): IngredientErrors {
  const errors: IngredientErrors = {};

  const name = form.name.trim();
  if (name.length === 0) errors.name = key("nameEmpty");
  else if (name.length > NAME_MAX) errors.name = key("nameTooLong");
  else if (existingNames.some((n) => norm(n) === norm(name))) errors.name = key("nameDuplicate");

  const q = form.quantity;
  if (q === null || !Number.isFinite(q) || q <= 0) errors.quantity = key("quantityPositive");
  else if (toBase(q, form.unit) > QUANTITY_MAX_BASE) errors.quantity = key("quantityTooLarge");

  const p = form.price;
  if (p === null || !Number.isFinite(p)) errors.price = key("priceRequired");
  else if (p < 0) errors.price = key("priceNegative");
  else if (p > PRICE_MAX[currency]) errors.price = key("priceTooLarge");
  // Prices are whole minor units (dong, cents); a fraction means the person typed more decimals than the currency has.
  else if (!Number.isInteger(p)) errors.price = key("priceDecimals");

  return errors;
}
