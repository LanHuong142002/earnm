import type { KeyValueStore } from "../sync/storage";
import { SIZE_NAMES, type ExtraCost, type Product } from "./types";

const CACHE_KEY = "products.cache.v1";

/** One project's products and extra costs as the server last sent them. */
export type ProjectProducts = { products: Product[]; extraCosts: ExtraCost[] };

/**
 * The products as the server last sent them, per project. Waiting changes are never saved in here: they live in the
 * queue and are laid over this list when it is shown (`applyProductOverlay`).
 */
export type ProductCache = { ownerId: string; byProject: Record<string, ProjectProducts> };

export const emptyProductCache = (ownerId: string): ProductCache => ({ ownerId, byProject: {} });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const isLine = (v: unknown): boolean =>
  isRecord(v) && typeof v.ingredientId === "string" && typeof v.amount === "number" && typeof v.included === "boolean" && typeof v.isDefault === "boolean";

const isExtra = (v: unknown): boolean =>
  isRecord(v) &&
  typeof v.id === "string" &&
  typeof v.name === "string" &&
  typeof v.amount === "number" &&
  typeof v.included === "boolean" &&
  typeof v.isDefault === "boolean" &&
  (v.extraCostId === null || typeof v.extraCostId === "string");

const isSize = (v: unknown): boolean =>
  isRecord(v) &&
  (SIZE_NAMES as readonly unknown[]).includes(v.size) &&
  (v.sellingPrice === null || typeof v.sellingPrice === "number") &&
  Array.isArray(v.lines) &&
  v.lines.every(isLine) &&
  Array.isArray(v.extras) &&
  v.extras.every(isExtra);

export function isProduct(value: unknown): value is Product {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.sizes) &&
    value.sizes.every(isSize) &&
    (value.fromDraftId === undefined || value.fromDraftId === null || typeof value.fromDraftId === "string")
  );
}

export function isExtraCost(value: unknown): value is ExtraCost {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.name === "string" &&
    typeof value.amount === "number" &&
    typeof value.isDefault === "boolean" &&
    typeof value.createdAt === "string"
  );
}

function read(raw: unknown, ownerId: string): ProductCache | null {
  if (!isRecord(raw) || raw.ownerId !== ownerId || !isRecord(raw.byProject)) return null;
  const byProject: Record<string, ProjectProducts> = {};
  for (const [projectId, entry] of Object.entries(raw.byProject)) {
    // One bad project makes only its own copy untrusted; it is fetched again.
    if (isRecord(entry) && Array.isArray(entry.products) && entry.products.every(isProduct) && Array.isArray(entry.extraCosts) && entry.extraCosts.every(isExtraCost)) {
      byProject[projectId] = { products: entry.products, extraCosts: entry.extraCosts };
    }
  }
  return { ownerId, byProject };
}

/** The saved cache of `ownerId`; empty when there is none, it is someone else's, or it cannot be read. */
export async function loadProductCache(store: KeyValueStore, ownerId: string): Promise<ProductCache> {
  try {
    return read(await store.getJSON<unknown>(CACHE_KEY), ownerId) ?? emptyProductCache(ownerId);
  } catch {
    return emptyProductCache(ownerId);
  }
}

/** Like `loadProductCache`, and a copy that belongs to someone else is removed so it is never read by mistake. */
export async function openProductCache(store: KeyValueStore, ownerId: string): Promise<ProductCache> {
  try {
    const raw = await store.getJSON<unknown>(CACHE_KEY);
    const cache = read(raw, ownerId);
    if (cache) return cache;
    if (raw !== null && raw !== undefined) await store.remove(CACHE_KEY);
  } catch {
    // Unreadable: start empty.
  }
  return emptyProductCache(ownerId);
}

export const saveProductCache = (store: KeyValueStore, cache: ProductCache): Promise<void> => store.setJSON(CACHE_KEY, cache);
export const clearProductCache = (store: KeyValueStore): Promise<void> => store.remove(CACHE_KEY);

const NO_PRODUCTS: Product[] = [];
const NO_EXTRAS: ExtraCost[] = [];

export const productsOf = (cache: ProductCache, projectId: string): Product[] => cache.byProject[projectId]?.products ?? NO_PRODUCTS;
export const extraCostsOf = (cache: ProductCache, projectId: string): ExtraCost[] => cache.byProject[projectId]?.extraCosts ?? NO_EXTRAS;
export const hasProducts = (cache: ProductCache, projectId: string): boolean => cache.byProject[projectId] !== undefined;

export const setProjectProducts = (cache: ProductCache, projectId: string, entry: ProjectProducts): ProductCache => ({
  ...cache,
  byProject: { ...cache.byProject, [projectId]: entry },
});

function withItem<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((i) => i.id === item.id);
  return index === -1 ? [...list, item] : list.map((i, n) => (n === index ? item : i));
}

export const withProduct = (list: Product[], item: Product): Product[] => withItem(list, item);
export const withoutProduct = (list: Product[], id: string): Product[] => list.filter((p) => p.id !== id);
export const withExtraCost = (list: ExtraCost[], item: ExtraCost): ExtraCost[] => withItem(list, item);
export const withoutExtraCost = (list: ExtraCost[], id: string): ExtraCost[] => list.filter((x) => x.id !== id);

/** Drops the products of projects that are no longer in `projectIds`. */
export function pruneProductCache(cache: ProductCache, projectIds: string[]): ProductCache {
  const keep = new Set(projectIds);
  return { ...cache, byProject: Object.fromEntries(Object.entries(cache.byProject).filter(([id]) => keep.has(id))) };
}
