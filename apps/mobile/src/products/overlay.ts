import { PROJECT_ENTITY } from "../projects/sync";
import type { Change } from "../sync/queue";
import type { SizeDefaults } from "./defaults";
import { EXTRA_COST_ENTITY, FIXED_COST_ENTITY, PRODUCT_ENTITY, PRODUCT_LINES_ENTITY, PRODUCT_PRICE_ENTITY } from "./entities";
import { FIXED_COST_KINDS, SIZE_NAMES, type ExtraCost, type FixedCost, type Product, type ProductSize, type SizeName, type SizeRecipe } from "./types";

const PRODUCT_ENTITIES = [PRODUCT_ENTITY, PRODUCT_PRICE_ENTITY, PRODUCT_LINES_ENTITY];

const isProductChange = (change: Change, projectId: string) => PRODUCT_ENTITIES.includes(change.entity) && change.data.projectId === projectId;
const isExtraCostChange = (change: Change, projectId: string) => change.entity === EXTRA_COST_ENTITY && change.data.projectId === projectId;
const isFixedCostChange = (change: Change, projectId: string) => change.entity === FIXED_COST_ENTITY && change.data.projectId === projectId;

/** The product a change is about: its own id, or for a price or recipe the product it belongs to. */
const productIdOf = (change: Change): string => (change.entity === PRODUCT_ENTITY ? change.entityId : String(change.data.productId));

const isSizeName = (v: unknown): v is SizeName => (SIZE_NAMES as readonly unknown[]).includes(v);
const sizeNames = (v: unknown): SizeName[] => (Array.isArray(v) ? SIZE_NAMES.filter((s) => v.includes(s)) : []);
type DefaultsBySize = Partial<Record<SizeName, SizeDefaults>>;
const defaultsOf = (v: unknown): DefaultsBySize => (typeof v === "object" && v !== null ? (v as DefaultsBySize) : {});

/** A size that starts from the default lines (what the server also builds when it creates the size). */
const freshSize = (size: SizeName, defaults: DefaultsBySize): ProductSize => ({
  size,
  sellingPrice: null,
  lines: (defaults[size]?.lines ?? []).map((l) => ({ ...l })),
  extras: (defaults[size]?.extras ?? []).map((x) => ({ ...x })),
});

function withSizes(product: Product, wanted: SizeName[], defaults: DefaultsBySize): Product {
  return { ...product, sizes: wanted.map((size) => product.sizes.find((s) => s.size === size) ?? freshSize(size, defaults)) };
}

function withRecipe(size: ProductSize, recipe: SizeRecipe): ProductSize {
  const wasDefault = new Set(size.lines.filter((l) => l.isDefault).map((l) => l.ingredientId));
  return {
    ...size,
    lines: recipe.lines.map((l) => ({ ingredientId: l.ingredientId, amount: l.amount, included: l.included, isDefault: wasDefault.has(l.ingredientId) })),
    extras: recipe.extras.map((x) => ({ ...x })),
  };
}

function applyToProduct(product: Product, change: Change): Product {
  const { data } = change;
  if (change.entity === PRODUCT_PRICE_ENTITY) {
    const value = data.value === null ? null : typeof data.value === "number" ? data.value : undefined;
    if (!isSizeName(data.size) || value === undefined) return product;
    return { ...product, sizes: product.sizes.map((s) => (s.size === data.size ? { ...s, sellingPrice: value } : s)) };
  }
  if (change.entity === PRODUCT_LINES_ENTITY) {
    const recipe = data.recipe as SizeRecipe | undefined;
    if (!isSizeName(data.size) || !recipe || !Array.isArray(recipe.lines) || !Array.isArray(recipe.extras)) return product;
    return { ...product, sizes: product.sizes.map((s) => (s.size === data.size ? withRecipe(s, recipe) : s)) };
  }
  let next = product;
  if (typeof data.name === "string") next = { ...next, name: data.name };
  if (Array.isArray(data.sizes)) next = withSizes(next, sizeNames(data.sizes), defaultsOf(data.defaults));
  return next;
}

function created(change: Change, projectId: string): Product {
  const base: Product = { id: change.entityId, projectId, name: "", createdAt: change.createdAt, sizes: [] };
  const withName = typeof change.data.name === "string" ? { ...base, name: change.data.name } : base;
  return withSizes(withName, sizeNames(change.data.sizes), defaultsOf(change.data.defaults));
}

/**
 * One project's products as the screen shows them: the server's list with the changes still waiting laid over it, in
 * the order they were made. A waiting create is a product with its default lines already in it (built on the phone
 * the way the server builds them), an edit shows its new values, a delete hides it. Changes for a product that is not
 * there are ignored. The list must be the server's.
 */
export function applyProductOverlay(projectId: string, serverList: Product[], waiting: Change[]): Product[] {
  let list = serverList;
  for (const change of waiting) {
    if (!isProductChange(change, projectId)) continue;
    const id = productIdOf(change);
    const index = list.findIndex((p) => p.id === id);
    if (change.entity === PRODUCT_ENTITY && change.kind === "delete") {
      list = list.filter((p) => p.id !== id);
    } else if (index === -1) {
      if (change.entity === PRODUCT_ENTITY && change.kind === "create") list = [...list, created(change, projectId)];
    } else {
      list = list.map((p, n) => (n === index ? applyToProduct(p, change) : p));
    }
  }
  return list;
}

/** The products of `projectId` with a change waiting (its own, a price or a recipe): they show "Chờ lưu". */
export function pendingProductIds(projectId: string, waiting: Change[]): ReadonlySet<string> {
  return new Set(waiting.filter((c) => isProductChange(c, projectId)).map(productIdOf));
}

function extraWithFields(item: ExtraCost, data: Record<string, unknown>): ExtraCost {
  const next = { ...item };
  if (typeof data.name === "string") next.name = data.name;
  if (typeof data.amount === "number") next.amount = data.amount;
  if (typeof data.isDefault === "boolean") next.isDefault = data.isDefault;
  return next;
}

/** The project's extra costs with the waiting changes laid over them, like `applyProductOverlay`. */
export function applyExtraCostOverlay(projectId: string, serverList: ExtraCost[], waiting: Change[]): ExtraCost[] {
  let list = serverList;
  for (const change of waiting) {
    if (!isExtraCostChange(change, projectId)) continue;
    const index = list.findIndex((x) => x.id === change.entityId);
    if (change.kind === "delete") {
      list = list.filter((x) => x.id !== change.entityId);
    } else if (index === -1) {
      if (change.kind === "create") {
        const base: ExtraCost = { id: change.entityId, projectId, name: "", amount: 0, isDefault: false, createdAt: change.createdAt };
        list = [...list, extraWithFields(base, change.data)];
      }
    } else {
      list = list.map((x, n) => (n === index ? extraWithFields(x, change.data) : x));
    }
  }
  return list;
}

export function pendingExtraCostIds(projectId: string, waiting: Change[]): ReadonlySet<string> {
  return new Set(waiting.filter((c) => isExtraCostChange(c, projectId)).map((c) => c.entityId));
}

function fixedWithFields(item: FixedCost, data: Record<string, unknown>): FixedCost {
  const next = { ...item };
  if (typeof data.name === "string") next.name = data.name;
  if ((FIXED_COST_KINDS as readonly unknown[]).includes(data.kind)) next.kind = data.kind as FixedCost["kind"];
  if (typeof data.amount === "number") next.amount = data.amount;
  if (typeof data.months === "number" || data.months === null) next.months = data.months;
  // Months belong to one-time costs only; the server clears them when the kind changes the same way.
  if (next.kind !== "oneTime") next.months = null;
  return next;
}

/** The project's fixed costs with the waiting changes laid over them, like `applyExtraCostOverlay`. */
export function applyFixedCostOverlay(projectId: string, serverList: FixedCost[], waiting: Change[]): FixedCost[] {
  let list = serverList;
  for (const change of waiting) {
    if (!isFixedCostChange(change, projectId)) continue;
    const index = list.findIndex((x) => x.id === change.entityId);
    if (change.kind === "delete") {
      list = list.filter((x) => x.id !== change.entityId);
    } else if (index === -1) {
      if (change.kind === "create") {
        const base: FixedCost = { id: change.entityId, projectId, name: "", kind: "monthly", amount: 0, months: null, createdAt: change.createdAt };
        list = [...list, fixedWithFields(base, change.data)];
      }
    } else {
      list = list.map((x, n) => (n === index ? fixedWithFields(x, change.data) : x));
    }
  }
  return list;
}

/** The fixed costs of `projectId` with a change waiting: they show "Chờ lưu". */
export function pendingFixedCostIds(projectId: string, waiting: Change[]): ReadonlySet<string> {
  return new Set(waiting.filter((c) => isFixedCostChange(c, projectId)).map((c) => c.entityId));
}

/** True while an edit of the project's expected cups per month is waiting ("Chờ lưu"). */
export const pendingExpectedCups = (projectId: string, waiting: Change[]): boolean =>
  waiting.some((c) => c.entity === PROJECT_ENTITY && c.entityId === projectId && c.kind !== "delete" && "expectedCupsPerMonth" in c.data);
