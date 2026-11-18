import type { KeyValueStore } from "../../sync/storage";
import type { ProjectReminders, RemindWithLine, ServerReminder } from "./types";

const CACHE_KEY = "reminders.cache.v1";

export type ReminderCache = {
  ownerId: string;
  /** Each project's reminders and the comments that ride along, as the server last sent them. */
  byProject: Record<string, ProjectReminders>;
};

export function emptyReminderCache(ownerId: string): ReminderCache {
  return { ownerId, byProject: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export function isServerReminder(v: unknown): v is ServerReminder {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.taskId === "string" &&
    typeof v.startDate === "string" &&
    typeof v.time === "string" &&
    typeof v.timezone === "string" &&
    (v.repeat === "once" || v.repeat === "daily" || v.repeat === "weekly" || v.repeat === "monthly") &&
    Array.isArray(v.weekdays) &&
    v.weekdays.every((d) => typeof d === "number") &&
    (v.endDate === null || typeof v.endDate === "string") &&
    isStringArray(v.recipientIds) &&
    (v.createdById === null || typeof v.createdById === "string") &&
    typeof v.changedAt === "string"
  );
}

function isRemindWithLine(v: unknown): v is RemindWithLine {
  return isRecord(v) && (v.author === null || typeof v.author === "string") && typeof v.text === "string";
}

/** The reply of the project reminders endpoint when it is shaped as expected, else null. */
export function parseProjectReminders(v: unknown): ProjectReminders | null {
  if (!isRecord(v) || !Array.isArray(v.reminders) || !v.reminders.every(isServerReminder) || !isRecord(v.remindWith)) return null;
  const remindWith: Record<string, RemindWithLine[]> = {};
  for (const [taskId, lines] of Object.entries(v.remindWith)) {
    if (!Array.isArray(lines) || !lines.every(isRemindWithLine)) return null;
    remindWith[taskId] = lines;
  }
  return { reminders: v.reminders, remindWith };
}

function parse(raw: unknown, ownerId: string): ReminderCache {
  if (!isRecord(raw) || raw.ownerId !== ownerId) return emptyReminderCache(ownerId);
  const byProject: Record<string, ProjectReminders> = {};
  if (isRecord(raw.byProject)) {
    for (const [projectId, entry] of Object.entries(raw.byProject)) {
      // One bad entry makes only that project's copy untrusted; it is fetched again.
      const parsed = parseProjectReminders(entry);
      if (parsed) byProject[projectId] = parsed;
    }
  }
  return { ownerId, byProject };
}

/** The saved cache of `ownerId`; empty when there is none, it is someone else's, or it cannot be read. */
export async function loadReminderCache(store: KeyValueStore, ownerId: string): Promise<ReminderCache> {
  try {
    return parse(await store.getJSON<unknown>(CACHE_KEY), ownerId);
  } catch {
    return emptyReminderCache(ownerId);
  }
}

export function clearReminderCache(store: KeyValueStore): Promise<void> {
  return store.remove(CACHE_KEY);
}

export function setProjectReminders(cache: ReminderCache, projectId: string, data: ProjectReminders): ReminderCache {
  return { ...cache, byProject: { ...cache.byProject, [projectId]: data } };
}

/** Drops the reminders of projects that are no longer in `projectIds` (pruned with the task cache). */
export function pruneReminderCache(cache: ReminderCache, projectIds: string[]): ReminderCache {
  const keep = new Set(projectIds);
  return { ...cache, byProject: Object.fromEntries(Object.entries(cache.byProject).filter(([id]) => keep.has(id))) };
}

// Readers and writers share one key, so every write reads the latest copy and writes behind the previous write.
const chains = new WeakMap<KeyValueStore, Promise<unknown>>();
const listeners = new Set<() => void>();

/** Runs `listener` after every write to the reminder cache. Returns an unsubscribe function. */
export function subscribeReminders(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads the cache, applies `change`, saves it and tells the listeners. Writes run one after another. */
export function updateReminderCache(store: KeyValueStore, ownerId: string, change: (cache: ReminderCache) => ReminderCache): Promise<ReminderCache> {
  const run = async () => {
    const next = change(await loadReminderCache(store, ownerId));
    await store.setJSON(CACHE_KEY, next);
    for (const listener of [...listeners]) listener();
    return next;
  };
  const previous = chains.get(store) ?? Promise.resolve();
  const result = previous.then(run, run);
  chains.set(store, result.catch(() => {}));
  return result;
}
