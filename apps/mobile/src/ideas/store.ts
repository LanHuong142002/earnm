import type { KeyValueStore } from "../sync/storage";
import { IDEA_STATUSES, type Idea } from "./types";
import { withVoteCounts } from "./voteCounts";

const CACHE_KEY = "ideas.cache.v1";

/**
 * The ideas as the server last sent them, per project. Waiting changes are never saved in here: they live in
 * the queue and are laid over this list when it is shown (`applyIdeaOverlay`).
 */
export type IdeaCache = {
  ownerId: string;
  byProject: Record<string, Idea[]>;
};

export function emptyIdeaCache(ownerId: string): IdeaCache {
  return { ownerId, byProject: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNameRef = (v: unknown): boolean => isRecord(v) && typeof v.id === "string" && typeof v.displayName === "string";

function isTaskRef(v: unknown): boolean {
  return isRecord(v) && typeof v.id === "string" && typeof v.title === "string" && typeof v.status === "string";
}

export function isIdea(value: unknown): value is Idea {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    (value.author === null || isNameRef(value.author)) &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    (IDEA_STATUSES as readonly unknown[]).includes(value.status) &&
    Array.isArray(value.labelIds) &&
    value.labelIds.every((id) => typeof id === "string") &&
    typeof value.score === "number" &&
    (value.likeCount === undefined || typeof value.likeCount === "number") &&
    (value.dislikeCount === undefined || typeof value.dislikeCount === "number") &&
    (value.myVote === -1 || value.myVote === 0 || value.myVote === 1) &&
    typeof value.commentCount === "number" &&
    typeof value.photoCount === "number" &&
    (value.taskId === null || typeof value.taskId === "string") &&
    (value.task === null || isTaskRef(value.task)) &&
    typeof value.createdAt === "string"
  );
}

function read(raw: unknown, ownerId: string): IdeaCache | null {
  if (!isRecord(raw) || raw.ownerId !== ownerId || !isRecord(raw.byProject)) return null;
  const byProject: Record<string, Idea[]> = {};
  for (const [projectId, list] of Object.entries(raw.byProject)) {
    // One bad project makes only its own copy untrusted; it is fetched again.
    if (Array.isArray(list) && list.every(isIdea)) byProject[projectId] = list.map(withVoteCounts);
  }
  return { ownerId, byProject };
}

/** The saved cache of `ownerId`; empty when there is none, it is someone else's, or it cannot be read. */
export async function loadIdeaCache(store: KeyValueStore, ownerId: string): Promise<IdeaCache> {
  try {
    return read(await store.getJSON<unknown>(CACHE_KEY), ownerId) ?? emptyIdeaCache(ownerId);
  } catch {
    return emptyIdeaCache(ownerId);
  }
}

/** Like `loadIdeaCache`, and a copy that belongs to someone else is removed so it is never read by mistake. */
export async function openIdeaCache(store: KeyValueStore, ownerId: string): Promise<IdeaCache> {
  try {
    const raw = await store.getJSON<unknown>(CACHE_KEY);
    const cache = read(raw, ownerId);
    if (cache) return cache;
    if (raw !== null && raw !== undefined) await store.remove(CACHE_KEY);
  } catch {
    // Unreadable: start empty.
  }
  return emptyIdeaCache(ownerId);
}

export function saveIdeaCache(store: KeyValueStore, cache: IdeaCache): Promise<void> {
  return store.setJSON(CACHE_KEY, cache);
}

export function clearIdeaCache(store: KeyValueStore): Promise<void> {
  return store.remove(CACHE_KEY);
}

const NO_IDEAS: Idea[] = [];

/** The project's cached ideas; an empty list when it was never fetched (see `hasIdeas` to tell the two apart). */
export const ideasOf = (cache: IdeaCache, projectId: string): Idea[] => cache.byProject[projectId] ?? NO_IDEAS;

export const hasIdeas = (cache: IdeaCache, projectId: string): boolean => cache.byProject[projectId] !== undefined;

export function setProjectIdeas(cache: IdeaCache, projectId: string, ideas: Idea[]): IdeaCache {
  return { ...cache, byProject: { ...cache.byProject, [projectId]: ideas } };
}

/** The list with `idea` in it: replaces the one with the same id, or adds it at the end. */
export function withIdea(list: Idea[], idea: Idea): Idea[] {
  const index = list.findIndex((i) => i.id === idea.id);
  return index === -1 ? [...list, idea] : list.map((i, n) => (n === index ? idea : i));
}

export const withoutIdea = (list: Idea[], ideaId: string): Idea[] => list.filter((i) => i.id !== ideaId);

/** Drops the ideas of projects that are no longer in `projectIds`. */
export function pruneIdeaCache(cache: IdeaCache, projectIds: string[]): IdeaCache {
  const keep = new Set(projectIds);
  return { ...cache, byProject: Object.fromEntries(Object.entries(cache.byProject).filter(([id]) => keep.has(id))) };
}
