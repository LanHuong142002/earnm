import type { Ingredient } from "../ingredients/types";
import type { Currency } from "../lib/currency";
import { hintPrice, marginPct, profit, sizeCost } from "./cost";
import { sortProducts, summarySize } from "./order";
import type { ExtraCost, Product, ProductSize, SizeName } from "./types";

export const PRODUCT_NAME_MAX = 60;
export const EXTRA_NAME_MAX = 40;
export const TARGET_MIN = 1;
export const TARGET_MAX = 95;

type IngredientLookup = Readonly<Record<string, Ingredient | undefined>>;

export function ingredientLookup(ingredients: readonly Ingredient[]): Record<string, Ingredient> {
  return Object.fromEntries(ingredients.map((i) => [i.id, i]));
}

/** The figures one size shows: cost split into recipe and extras, price, profit, margin and the price hint. */
export type SizeFigures = {
  recipeCost: number;
  extrasCost: number;
  cost: number;
  price: number | null;
  profit: number | null;
  margin: number | null;
  /** The price that reaches the target margin; null when the target cannot be reached. */
  hint: number | null;
  /** A margin under the target: shown as quiet text, never as an error. */
  belowTarget: boolean;
};

export function sizeFigures(size: ProductSize, ingredients: IngredientLookup, target: number, currency: Currency): SizeFigures {
  const recipeCost = sizeCost(size.lines, ingredients, []);
  const extrasCost = sizeCost([], ingredients, size.extras);
  const cost = recipeCost + extrasCost;
  const gain = profit(size.sellingPrice, cost);
  const margin = gain === null ? null : marginPct(gain, size.sellingPrice);
  return {
    recipeCost,
    extrasCost,
    cost,
    price: size.sellingPrice,
    profit: gain,
    margin,
    hint: hintPrice(cost, target, currency),
    belowTarget: margin !== null && margin < target,
  };
}

export type ProductRow = {
  id: string;
  name: string;
  sizes: SizeName[];
  /** The size the row summarises (M, else the smallest); null only for a product without sizes. */
  summary: { size: SizeName; figures: SizeFigures } | null;
};

/** The products A-Z, each with its sizes and the figures of the size it summarises (spec R16). */
export function productRows(products: readonly Product[], ingredients: IngredientLookup, target: number, currency: Currency): ProductRow[] {
  return sortProducts(products).map((product) => {
    const sizes = product.sizes.map((s) => s.size);
    const picked = summarySize(product.sizes);
    return {
      id: product.id,
      name: product.name,
      sizes,
      summary: picked ? { size: picked.size, figures: sizeFigures(picked, ingredients, target, currency) } : null,
    };
  });
}

/** Names of the products whose recipes use the ingredient, A-Z (spec R8). */
export function productsUsing(ingredientId: string, products: readonly Product[]): string[] {
  return sortProducts(products.filter((p) => p.sizes.some((s) => s.lines.some((l) => l.ingredientId === ingredientId)))).map((p) => p.name);
}

/** "A", "A và B", "A, B và C"; `and` is the language's word. */
export function joinNames(names: readonly string[], and: string): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

export type NameError = "nameEmpty" | "nameTooLong" | "nameDuplicate";

/** A product or extra cost name: trimmed, 1..max characters, unique ignoring case among `others`. */
export function validateName(name: string, others: readonly string[], max: number): NameError | null {
  const clean = name.trim();
  if (clean.length === 0) return "nameEmpty";
  if (clean.length > max) return "nameTooLong";
  const key = clean.toLocaleLowerCase("vi");
  if (others.some((o) => o.trim().toLocaleLowerCase("vi") === key)) return "nameDuplicate";
  return null;
}

/** The size to show: the wanted one while it exists, else M, else the first. */
export function pickSize(sizes: readonly SizeName[], wanted: SizeName | null): SizeName | null {
  if (wanted && sizes.includes(wanted)) return wanted;
  return sizes.includes("M") ? "M" : (sizes[0] ?? null);
}

/** Adds or removes `size`; the last chosen size stays (a product always has one). */
export function toggleSize(chosen: readonly SizeName[], size: SizeName): SizeName[] {
  const order: SizeName[] = ["S", "M", "L"];
  const next = chosen.includes(size) ? chosen.filter((s) => s !== size) : [...chosen, size];
  if (next.length === 0) return [...chosen];
  return order.filter((s) => next.includes(s));
}

/** What a new size starts with, named for the note of the new-product form: default ingredients, then default extra costs. */
export function defaultNames(ingredients: readonly Ingredient[], extraCosts: readonly ExtraCost[]): string[] {
  const byCreated = <T extends { createdAt: string }>(a: T, b: T) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  return [
    ...ingredients.filter((i) => i.isDefault).sort(byCreated).map((i) => i.name),
    ...extraCosts.filter((x) => x.isDefault).sort(byCreated).map((x) => x.name),
  ];
}

/** A target margin typed as text: a whole percent from 1 to 95, else null. */
export function parseTarget(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= TARGET_MIN && value <= TARGET_MAX ? value : null;
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi")
    .trim();

/** Whether `name` matches what was typed in a search box, ignoring case and Vietnamese tone marks. */
export function matchesQuery(name: string, query: string): boolean {
  const q = fold(query);
  return q === "" || fold(name).includes(q);
}

/** The ingredients whose price changed at least once (more than one price entry), for the "Giá vốn cập nhật" line. */
export function withPriceChanges<T extends { prices: readonly unknown[] }>(lookup: Readonly<Record<string, T | undefined>>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, item] of Object.entries(lookup)) if (item && item.prices.length > 1) out[id] = item;
  return out;
}
