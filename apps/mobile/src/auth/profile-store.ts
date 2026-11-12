import type { KeyValueStore } from "../sync/storage";

const KEY = "profile.v1";

export type Profile = { email: string; displayName: string };
export type StoredProfile = Profile & { userId: string };

/** Stored copy of the profile for this user, or null for nothing, another user or bad data. */
export async function readProfile(store: KeyValueStore, userId: string): Promise<Profile | null> {
  let saved: unknown;
  try {
    saved = await store.getJSON<unknown>(KEY);
  } catch {
    return null;
  }
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return null;
  const p = saved as Record<string, unknown>;
  if (typeof p.userId !== "string" || typeof p.email !== "string" || typeof p.displayName !== "string") return null;
  if (p.userId !== userId) return null;
  return { email: p.email, displayName: p.displayName };
}

export function writeProfile(store: KeyValueStore, profile: StoredProfile): Promise<void> {
  return store.setJSON(KEY, profile);
}

export function clearProfile(store: KeyValueStore): Promise<void> {
  return store.remove(KEY);
}

/** The signed-in user when known, otherwise the stored copy (offline cold start). */
export function visibleProfile(
  user: { email: string; displayName: string } | null,
  stored: Profile | null,
): Profile | null {
  if (user) return { email: user.email, displayName: user.displayName };
  return stored;
}
