import { INGREDIENT_MODES } from "../ingredients/types";
import { SIZE_NAMES } from "../products/types";
import type { KeyValueStore } from "../sync/storage";
import type { Draft } from "./types";

const CACHE_KEY = "drafts.cache.v1";

/**
 * The drafts as the server last sent them, per project. Waiting changes are never saved in here: they live in the
 * queue and are laid over this list when it is shown (`applyDraftOverlay`).
 */
export type DraftCache = {
  ownerId: string;
  byProject: Record<string, Draft[]>;
  /** How many converted drafts the server has per project (the list sends only the newest 50). Absent in older copies. */
  convertedTotals?: Record<string, number>;
};

export const emptyDraftCache = (ownerId: string): DraftCache => ({ ownerId, byProject: {} });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const orNull = (v: unknown, type: "string" | "number") => v === null || typeof v === type;

const isLine = (v: unknown): boolean =>
  isRecord(v) &&
  typeof v.id === "string" &&
  (v.kind === "existing" || v.kind === "new") &&
  orNull(v.ingredientId, "string") &&
  orNull(v.newName, "string") &&
  (v.newKind === null || (INGREDIENT_MODES as readonly unknown[]).includes(v.newKind)) &&
  orNull(v.purchaseQty, "number") &&
  orNull(v.purchasePrice, "number") &&
  typeof v.amount === "number";

export function isDraft(value: unknown): value is Draft {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.name === "string" &&
    Array.isArray(value.sizes) &&
    value.sizes.every((s) => (SIZE_NAMES as readonly unknown[]).includes(s)) &&
    orNull(value.expectedPrice, "number") &&
    typeof value.note === "string" &&
    (value.status === "working" || value.status === "done") &&
    orNull(value.productId, "string") &&
    orNull(value.convertedAt, "string") &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.lines) &&
    value.lines.every(isLine)
  );
}

function read(raw: unknown, ownerId: string): DraftCache {
  if (!isRecord(raw) || raw.ownerId !== ownerId || !isRecord(raw.byProject)) return emptyDraftCache(ownerId);
  const byProject: Record<string, Draft[]> = {};
  for (const [projectId, list] of Object.entries(raw.byProject)) {
    // A project whose copy is unreadable is dropped; the next fetch brings it back.
    if (Array.isArray(list) && list.every(isDraft)) byProject[projectId] = list;
  }
  const convertedTotals: Record<string, number> = {};
  if (isRecord(raw.convertedTotals)) {
    for (const [projectId, n] of Object.entries(raw.convertedTotals)) {
      if (typeof n === "number" && Number.isInteger(n) && n >= 0 && byProject[projectId] !== undefined) convertedTotals[projectId] = n;
    }
  }
  return { ownerId, byProject, convertedTotals };
}

export async function loadDraftCache(store: KeyValueStore, ownerId: string): Promise<DraftCache> {
  try {
    return read(await store.getJSON<unknown>(CACHE_KEY), ownerId);
  } catch {
    return emptyDraftCache(ownerId);
  }
}

/** Like `loadDraftCache`, and removes the copy of another person. */
export async function openDraftCache(store: KeyValueStore, ownerId: string): Promise<DraftCache> {
  const raw = await store.getJSON<unknown>(CACHE_KEY);
  if (isRecord(raw) && raw.ownerId !== ownerId) await store.remove(CACHE_KEY);
  return read(raw, ownerId);
}

export const saveDraftCache = (store: KeyValueStore, cache: DraftCache) => store.setJSON(CACHE_KEY, cache);
export const clearDraftCache = (store: KeyValueStore) => store.remove(CACHE_KEY);

const NO_DRAFTS: Draft[] = [];

export const draftsOf = (cache: DraftCache, projectId: string): Draft[] => cache.byProject[projectId] ?? NO_DRAFTS;
export const hasDrafts = (cache: DraftCache, projectId: string): boolean => cache.byProject[projectId] !== undefined;

/** Saves the project's list; `convertedTotal` replaces the saved total, and left out it keeps the saved one. */
export const setProjectDrafts = (cache: DraftCache, projectId: string, list: Draft[], convertedTotal?: number): DraftCache => ({
  ...cache,
  byProject: { ...cache.byProject, [projectId]: list },
  ...(convertedTotal === undefined ? {} : { convertedTotals: { ...cache.convertedTotals, [projectId]: convertedTotal } }),
});

export const convertedTotalOf = (cache: DraftCache, projectId: string): number | null => cache.convertedTotals?.[projectId] ?? null;

export function withDraft(list: Draft[], item: Draft): Draft[] {
  const index = list.findIndex((d) => d.id === item.id);
  return index === -1 ? [...list, item] : list.map((d, n) => (n === index ? item : d));
}
export const withoutDraft = (list: Draft[], id: string): Draft[] => list.filter((d) => d.id !== id);
export const withoutDraftLine = (list: Draft[], draftId: string, lineId: string): Draft[] =>
  list.map((d) => (d.id === draftId ? { ...d, lines: d.lines.filter((l) => l.id !== lineId) } : d));

/** Drops the drafts of projects that are no longer in `projectIds`. */
export function pruneDraftCache(cache: DraftCache, projectIds: string[]): DraftCache {
  const keep = new Set(projectIds);
  const only = <T,>(map: Record<string, T>) => Object.fromEntries(Object.entries(map).filter(([id]) => keep.has(id)));
  return {
    ...cache,
    byProject: only(cache.byProject),
    ...(cache.convertedTotals ? { convertedTotals: only(cache.convertedTotals) } : {}),
  };
}
