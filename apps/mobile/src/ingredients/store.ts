import type { KeyValueStore } from "../sync/storage";
import { INGREDIENT_MODES, type Ingredient } from "./types";

const CACHE_KEY = "ingredients.cache.v1";

/**
 * The ingredients as the server last sent them, per project. Waiting changes are never saved in here: they live in
 * the queue and are laid over this list when it is shown (`applyIngredientOverlay`).
 */
export type IngredientCache = {
  ownerId: string;
  byProject: Record<string, Ingredient[]>;
};

export function emptyIngredientCache(ownerId: string): IngredientCache {
  return { ownerId, byProject: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UNITS = ["kg", "g", "l", "ml", "portion"];

function isPurchase(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v.quantity === "number" &&
    typeof v.price === "number" &&
    typeof v.unit === "string" &&
    UNITS.includes(v.unit)
  );
}

function isPriceEntry(v: unknown): boolean {
  return (
    isRecord(v) &&
    isPurchase(v) &&
    typeof v.id === "string" &&
    typeof v.recordedAt === "string" &&
    (v.author === null || (isRecord(v.author) && typeof v.author.id === "string" && typeof v.author.displayName === "string"))
  );
}

export function isIngredient(value: unknown): value is Ingredient {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.name === "string" &&
    (INGREDIENT_MODES as readonly unknown[]).includes(value.mode) &&
    typeof value.isDefault === "boolean" &&
    isPurchase(value.purchase) &&
    Array.isArray(value.prices) &&
    value.prices.every(isPriceEntry) &&
    typeof value.createdAt === "string"
  );
}

function read(raw: unknown, ownerId: string): IngredientCache | null {
  if (!isRecord(raw) || raw.ownerId !== ownerId || !isRecord(raw.byProject)) return null;
  const byProject: Record<string, Ingredient[]> = {};
  for (const [projectId, list] of Object.entries(raw.byProject)) {
    // One bad project makes only its own copy untrusted; it is fetched again.
    if (Array.isArray(list) && list.every(isIngredient)) byProject[projectId] = list;
  }
  return { ownerId, byProject };
}

/** The saved cache of `ownerId`; empty when there is none, it is someone else's, or it cannot be read. */
export async function loadIngredientCache(store: KeyValueStore, ownerId: string): Promise<IngredientCache> {
  try {
    return read(await store.getJSON<unknown>(CACHE_KEY), ownerId) ?? emptyIngredientCache(ownerId);
  } catch {
    return emptyIngredientCache(ownerId);
  }
}

/** Like `loadIngredientCache`, and a copy that belongs to someone else is removed so it is never read by mistake. */
export async function openIngredientCache(store: KeyValueStore, ownerId: string): Promise<IngredientCache> {
  try {
    const raw = await store.getJSON<unknown>(CACHE_KEY);
    const cache = read(raw, ownerId);
    if (cache) return cache;
    if (raw !== null && raw !== undefined) await store.remove(CACHE_KEY);
  } catch {
    // Unreadable: start empty.
  }
  return emptyIngredientCache(ownerId);
}

export function saveIngredientCache(store: KeyValueStore, cache: IngredientCache): Promise<void> {
  return store.setJSON(CACHE_KEY, cache);
}

export function clearIngredientCache(store: KeyValueStore): Promise<void> {
  return store.remove(CACHE_KEY);
}

const NO_INGREDIENTS: Ingredient[] = [];

/** The project's cached ingredients; empty when never fetched (see `hasIngredients` to tell the two apart). */
export const ingredientsOf = (cache: IngredientCache, projectId: string): Ingredient[] => cache.byProject[projectId] ?? NO_INGREDIENTS;

export const hasIngredients = (cache: IngredientCache, projectId: string): boolean => cache.byProject[projectId] !== undefined;

export function setProjectIngredients(cache: IngredientCache, projectId: string, list: Ingredient[]): IngredientCache {
  return { ...cache, byProject: { ...cache.byProject, [projectId]: list } };
}

/** The list with `item` in it: replaces the one with the same id, or adds it at the end. */
export function withIngredient(list: Ingredient[], item: Ingredient): Ingredient[] {
  const index = list.findIndex((i) => i.id === item.id);
  return index === -1 ? [...list, item] : list.map((i, n) => (n === index ? item : i));
}

export const withoutIngredient = (list: Ingredient[], id: string): Ingredient[] => list.filter((i) => i.id !== id);

/** Drops the ingredients of projects that are no longer in `projectIds`. */
export function pruneIngredientCache(cache: IngredientCache, projectIds: string[]): IngredientCache {
  const keep = new Set(projectIds);
  return { ...cache, byProject: Object.fromEntries(Object.entries(cache.byProject).filter(([id]) => keep.has(id))) };
}
