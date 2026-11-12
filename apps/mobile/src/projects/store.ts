import { cleanMultiLine, cleanSingleLine } from "../lib/text";
import type { Currency } from "../lib/currency";
import type { Change } from "../sync/queue";
import type { KeyValueStore } from "../sync/storage";
import type { Project } from "./api";

const ENTITY = "project";
const CACHE_KEY = "projects.cache.v1";

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 500;

const CURRENCIES: readonly string[] = ["VND", "USD"];

/**
 * Server list with the waiting changes replayed on top, so offline edits never vanish
 * from screen after a refresh. Order: server order, then newly created projects in the
 * order they were made. Only changes for entity "project" are applied.
 */
export function applyOverlay(serverList: Project[], waiting: Change[]): Project[] {
  let list: Project[] = serverList.map((p) => ({ ...p }));
  for (const change of waiting) {
    if (change.entity !== ENTITY) continue;
    const index = list.findIndex((p) => p.id === change.entityId);
    if (change.kind === "delete") {
      if (index >= 0) list = list.filter((_, i) => i !== index);
    } else if (change.kind === "update") {
      if (index >= 0) list[index] = { ...list[index], ...(change.data as Partial<Project>) };
    } else if (index >= 0) {
      list[index] = { ...list[index], ...(change.data as Partial<Project>) };
    } else {
      list.push({
        description: "",
        ...(change.data as Partial<Project>),
        id: change.entityId,
        role: "owner",
      } as Project);
    }
  }
  return list;
}

export type ProjectInput = { name: string; description: string; currency: string };
export type ProjectInputErrors = {
  name?: "required" | "too_long";
  description?: "too_long";
  currency?: "invalid";
};
export type ProjectValidation =
  | { ok: true; value: { name: string; description: string; currency: Currency } }
  | { ok: false; errors: ProjectInputErrors };

/** Same limits as the server (spec R1): name 1-80, description 0-500, currency VND or USD. */
export function validateProjectInput(input: ProjectInput): ProjectValidation {
  const name = cleanSingleLine(input.name);
  const description = cleanMultiLine(input.description);
  const errors: ProjectInputErrors = {};
  if (name.length === 0) errors.name = "required";
  else if (name.length > NAME_MAX) errors.name = "too_long";
  if (description.length > DESCRIPTION_MAX) errors.description = "too_long";
  if (!CURRENCIES.includes(input.currency)) errors.currency = "invalid";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, description, currency: input.currency as Currency } };
}

export type ProjectCache = {
  userId: string;
  projects: Project[];
  currentProjectId: string | null;
};

export function isProject(value: unknown): value is Project {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.description === "string" &&
    typeof p.currency === "string" &&
    CURRENCIES.includes(p.currency) &&
    (p.role === "owner" || p.role === "member")
  );
}

export async function loadProjectCache(store: KeyValueStore): Promise<ProjectCache | null> {
  let saved: unknown;
  try {
    saved = await store.getJSON<unknown>(CACHE_KEY);
  } catch {
    return null;
  }
  if (typeof saved !== "object" || saved === null) return null;
  const c = saved as Record<string, unknown>;
  if (typeof c.userId !== "string" || !Array.isArray(c.projects) || !c.projects.every(isProject)) return null;
  if (c.currentProjectId !== null && typeof c.currentProjectId !== "string") return null;
  return { userId: c.userId, projects: c.projects, currentProjectId: c.currentProjectId };
}

export function saveProjectCache(store: KeyValueStore, cache: ProjectCache): Promise<void> {
  return store.setJSON(CACHE_KEY, cache);
}

export function clearProjectCache(store: KeyValueStore): Promise<void> {
  return store.remove(CACHE_KEY);
}
