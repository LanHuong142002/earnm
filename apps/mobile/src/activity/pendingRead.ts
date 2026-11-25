import type { KeyValueStore } from "../sync/storage";

/** The server takes at most this many event ids per call. */
export const READ_BATCH = 100;

const keyFor = (userId: string) => `activity.pendingRead.${userId}`;

/** Event ids marked read on this phone that the server has not heard about yet (R31, R34). */
export async function loadPendingRead(store: KeyValueStore, userId: string): Promise<string[]> {
  const ids = await store.getJSON<unknown>(keyFor(userId));
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export async function addPendingRead(store: KeyValueStore, userId: string, ids: readonly string[]): Promise<string[]> {
  const merged = [...new Set([...(await loadPendingRead(store, userId)), ...ids])];
  await store.setJSON(keyFor(userId), merged);
  return merged;
}

const allKeyFor = (userId: string) => `activity.pendingReadAll.${userId}`;

/** Remembers that "Đọc hết" was tapped here and the server has not heard: it marks the unread on pages never loaded too. */
export async function markPendingReadAll(store: KeyValueStore, userId: string): Promise<void> {
  await store.setJSON(allKeyFor(userId), true);
}

export async function hasPendingReadAll(store: KeyValueStore, userId: string): Promise<boolean> {
  return (await store.getJSON<unknown>(allKeyFor(userId))) === true;
}

export async function clearPendingReadAll(store: KeyValueStore, userId: string): Promise<void> {
  await store.remove(allKeyFor(userId));
}

/** Clears everything waiting for this person: the ids and the read-all marker. */
export async function clearPendingRead(store: KeyValueStore, userId: string): Promise<void> {
  await store.remove(keyFor(userId));
  await store.remove(allKeyFor(userId));
}

/** Sends the read-all marker if one waits; it is cleared only when the server took it (or refused it for good). */
export async function flushReadAll(
  store: KeyValueStore,
  userId: string,
  sendAll: () => Promise<void>,
  isFinal: (error: unknown) => boolean = () => false,
): Promise<FlushResult> {
  if (!(await hasPendingReadAll(store, userId))) return "empty";
  try {
    await sendAll();
  } catch (error) {
    if (!isFinal(error)) return "failed";
  }
  await clearPendingReadAll(store, userId);
  return "sent";
}

export type FlushResult = "empty" | "sent" | "failed";

/**
 * Sends the waiting ids in batches, dropping each batch from the set once the server took it. Ids added while this
 * runs stay. On a failure the rest stay waiting for the next time the phone is online or the app is in front.
 */
export async function flushPendingRead(
  store: KeyValueStore,
  userId: string,
  send: (eventIds: string[]) => Promise<void>,
  /** True for an error that will never succeed on a retry (the server refused the ids): the batch is dropped. */
  isFinal: (error: unknown) => boolean = () => false,
): Promise<FlushResult> {
  const waiting = await loadPendingRead(store, userId);
  if (waiting.length === 0) return "empty";
  for (let i = 0; i < waiting.length; i += READ_BATCH) {
    const batch = waiting.slice(i, i + READ_BATCH);
    try {
      await send(batch);
    } catch (error) {
      if (!isFinal(error)) return "failed";
    }
    const sent = new Set(batch);
    const rest = (await loadPendingRead(store, userId)).filter((id) => !sent.has(id));
    if (rest.length === 0) await store.remove(keyFor(userId));
    else await store.setJSON(keyFor(userId), rest);
  }
  return "sent";
}
