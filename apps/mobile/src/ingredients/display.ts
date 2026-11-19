import { formatMoney, type Currency } from "../lib/currency";
import { per1, per10, toBase, type IngredientUnit } from "./cost";
import type { Ingredient, IngredientMode, Purchase } from "./types";
import type { IngredientForm } from "./validate";

/** The units a mode lets the person buy in, in the order the switch shows them. */
export function unitsFor(mode: IngredientMode): IngredientUnit[] {
  if (mode === "weight") return ["kg", "g"];
  if (mode === "volume") return ["l", "ml"];
  return ["portion"];
}

const DEFAULT_UNIT: Record<IngredientMode, IngredientUnit> = { weight: "g", volume: "ml", portion: "portion" };

/** The base unit a cost is per: g, ml or portion. */
export function baseUnitOf(unit: IngredientUnit): "g" | "ml" | "portion" {
  if (unit === "kg" || unit === "g") return "g";
  if (unit === "l" || unit === "ml") return "ml";
  return "portion";
}

/** A stored base quantity in the unit the person chose: kg and l divide by 1000. */
export function displayQuantity(base: number, unit: IngredientUnit): number {
  return unit === "kg" || unit === "l" ? Math.round(base) / 1000 : base;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** A quantity to read: up to 3 decimals with a comma, dots between thousands ("1.234,5"). */
export function formatQuantity(value: number): string {
  const [whole, fraction] = (Math.round(value * 1000) / 1000).toFixed(3).split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${group(whole)}${trimmed ? `,${trimmed}` : ""}`;
}

/** A quantity to edit: no grouping, comma as the decimal mark. */
function quantityInput(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace(".", ",");
}

/** Reads what was typed into the quantity field; a comma or a dot is the decimal mark. */
export function parseQuantityText(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(clean)) return null;
  return Number(clean);
}

/** Reads the price field as minor units: whole dong for VND, cents for USD (typed as dollars). */
export function parsePriceText(text: string, currency: Currency): number | null {
  if (currency === "VND") {
    const digits = text.replace(/\D/g, "");
    return digits === "" ? null : Number(digits);
  }
  const clean = text.trim().replace(",", ".").replace(/[^\d.]/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(clean)) return null;
  // Trailing zeros are not decimals ("18.100"). A real third decimal stays a fraction of a cent, not rounded away,
  // so validation can refuse it instead of silently saving a different price.
  const decimals = (clean.split(".")[1] ?? "").replace(/0+$/, "").length;
  const cents = Number(clean) * 100;
  return decimals > 2 ? cents : Math.round(cents);
}

/** What the price field shows while typing: VND gets dots between thousands, USD stays as typed. */
export function formatPriceText(text: string, currency: Currency): string {
  if (currency !== "VND") return text;
  return group(text.replace(/\D/g, ""));
}

function priceInput(minor: number, currency: Currency): string {
  if (currency === "VND") return group(String(minor));
  return quantityInput(minor / 100);
}

/** Minor units (dong or cents) as money: "180.000 ₫", "$18.00". */
export function moneyOf(minor: number, currency: Currency): string {
  return formatMoney(currency === "USD" ? minor / 100 : minor, currency);
}

export type IngredientFormValues = {
  name: string;
  mode: IngredientMode;
  quantityText: string;
  unit: IngredientUnit;
  priceText: string;
  isDefault: boolean;
};

export function emptyIngredientForm(): IngredientFormValues {
  return { name: "", mode: "weight", quantityText: "", unit: "g", priceText: "", isDefault: false };
}

export function formFromIngredient(item: Ingredient, currency: Currency): IngredientFormValues {
  const { quantity, unit, price } = item.purchase;
  return {
    name: item.name,
    mode: item.mode,
    quantityText: quantityInput(displayQuantity(quantity, unit)),
    unit,
    priceText: priceInput(price, currency),
    isDefault: item.isDefault,
  };
}

/** Switching mode switches to that mode's usual unit; what was typed stays. */
export function changeMode(form: IngredientFormValues, mode: IngredientMode): IngredientFormValues {
  if (form.mode === mode) return form;
  return { ...form, mode, unit: DEFAULT_UNIT[mode] };
}

/** The form as the validator reads it. */
export function validationInput(form: IngredientFormValues, currency: Currency): IngredientForm {
  return {
    name: form.name,
    quantity: parseQuantityText(form.quantityText),
    unit: form.unit,
    price: parsePriceText(form.priceText, currency),
  };
}

/** What was bought, in base units; null while the quantity or the price can't be read. */
export function purchaseFromForm(form: IngredientFormValues, currency: Currency): Purchase | null {
  const quantity = parseQuantityText(form.quantityText);
  const price = parsePriceText(form.priceText, currency);
  if (quantity === null || price === null) return null;
  return { quantity: toBase(quantity, form.unit), unit: form.unit, price };
}

/** The live result card: cost per 1 and per 10 base units, or null while it can't be computed. */
export function liveResult(form: IngredientFormValues, currency: Currency): { per1: number; per10: number } | null {
  const purchase = purchaseFromForm(form, currency);
  if (!purchase) return null;
  const one = per1(purchase.price, purchase.quantity);
  const ten = per10(purchase.price, purchase.quantity);
  return one === null || ten === null ? null : { per1: one, per10: ten };
}
