import type { Member } from "../lib/api";
import type { KeyValueStore } from "../sync/storage";

const CACHE_KEY = "members.cache.v1";

type MemberCache = { userId: string; byProject: Record<string, Member[]> };

function isMember(v: unknown): v is Member {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.userId === "string" &&
    typeof m.displayName === "string" &&
    (m.role === "owner" || m.role === "member") &&
    typeof m.joinedAt === "string"
  );
}

async function read(store: KeyValueStore): Promise<MemberCache | null> {
  let saved: unknown;
  try {
    saved = await store.getJSON<unknown>(CACHE_KEY);
  } catch {
    return null;
  }
  if (typeof saved !== "object" || saved === null) return null;
  const c = saved as Record<string, unknown>;
  if (typeof c.userId !== "string" || typeof c.byProject !== "object" || c.byProject === null) return null;
  const byProject: Record<string, Member[]> = {};
  for (const [id, list] of Object.entries(c.byProject)) {
    if (Array.isArray(list) && list.every(isMember)) byProject[id] = list;
  }
  return { userId: c.userId, byProject };
}

/** The cached list for a project, or null when none is saved or it belongs to another user. */
export async function loadMembers(store: KeyValueStore, userId: string, projectId: string): Promise<Member[] | null> {
  const cache = await read(store);
  if (!cache || cache.userId !== userId) return null;
  return cache.byProject[projectId] ?? null;
}

export async function saveMembers(
  store: KeyValueStore,
  userId: string,
  projectId: string,
  members: Member[],
): Promise<void> {
  const cache = await read(store);
  const byProject = cache && cache.userId === userId ? cache.byProject : {};
  await store.setJSON(CACHE_KEY, { userId, byProject: { ...byProject, [projectId]: members } });
}

export async function removeProjectMembers(store: KeyValueStore, userId: string, projectId: string): Promise<void> {
  const cache = await read(store);
  if (!cache || cache.userId !== userId || !(projectId in cache.byProject)) return;
  const { [projectId]: _gone, ...rest } = cache.byProject;
  await store.setJSON(CACHE_KEY, { userId, byProject: rest });
}

export function clearMemberCache(store: KeyValueStore): Promise<void> {
  return store.remove(CACHE_KEY);
}
