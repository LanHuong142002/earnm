import type { Change } from "../sync/queue";
import type { Project, ProjectField } from "./api";
import { validateProjectInput, type ProjectCache, type ProjectInput, type ProjectInputErrors } from "./store";

const FIELDS: (keyof ProjectInput)[] = ["name", "description", "currency"];

/** An edit may also carry the target margin: a whole percent from 1 to 95 (the server's range). */
export type ProjectEdit = Partial<ProjectInput> & { targetMargin?: number; expectedCupsPerMonth?: number | null };
export const isValidTargetMargin = (v: number) => Number.isInteger(v) && v >= 1 && v <= 95;
/** Expected cups per month: a whole number from 1 to 1.000.000 (the server's range), or null to clear it. */
export const isValidExpectedCups = (v: number | null) => v === null || (Number.isInteger(v) && v >= 1 && v <= 1_000_000);

/** Only the fields whose value differs from `current` (the values a form opened with, or a project). */
export function changedFields(
  current: ProjectInput,
  next: Partial<ProjectInput>,
): Partial<ProjectInput> {
  const out: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (field in next && next[field] !== undefined && next[field] !== current[field]) out[field] = next[field];
  }
  return out as Partial<ProjectInput>;
}

/**
 * Validates an edit (the merged result against the cached project) and returns exactly the
 * fields the person gave, with their validated values. Fields they did not touch are never sent,
 * so a refresh that changed them meanwhile is not reverted.
 */
export function planUpdate(
  current: Project,
  fields: ProjectEdit,
): { ok: true; changed: Partial<Pick<Project, ProjectField>> } | { ok: false; errors: ProjectInputErrors } {
  const result = validateProjectInput({
    name: fields.name ?? current.name,
    description: fields.description ?? current.description,
    currency: fields.currency ?? current.currency,
  });
  const bad: ProjectInputErrors = {};
  if (fields.targetMargin !== undefined && !isValidTargetMargin(fields.targetMargin)) bad.targetMargin = "invalid";
  if (fields.expectedCupsPerMonth !== undefined && !isValidExpectedCups(fields.expectedCupsPerMonth)) bad.expectedCupsPerMonth = "invalid";
  if (Object.keys(bad).length > 0) return { ok: false, errors: { ...(result.ok ? {} : result.errors), ...bad } };
  if (!result.ok) return result;
  const changed: Record<string, unknown> = {};
  for (const field of FIELDS) if (fields[field] !== undefined) changed[field] = result.value[field];
  if (fields.targetMargin !== undefined) changed.targetMargin = fields.targetMargin;
  if (fields.expectedCupsPerMonth !== undefined) changed.expectedCupsPerMonth = fields.expectedCupsPerMonth;
  return { ok: true, changed: changed as Partial<Pick<Project, ProjectField>> };
}

/** The cache after the server accepted `change`: its returned project in, or the project out for a delete. */
export function withApplied(list: Project[], change: Change, response: Project | undefined): Project[] {
  if (change.kind === "delete" || !response) return list.filter((p) => p.id !== change.entityId);
  const index = list.findIndex((p) => p.id === response.id);
  if (index < 0) return [...list, response];
  return list.map((p, i) => (i === index ? response : p));
}

/**
 * Whether the stored project cache must go when a known user signs in: it was owned by
 * someone else, or the queue just dropped another person's changes. An empty cache is kept.
 */
export type CacheStep = { show: boolean; settleOwnership: boolean; clear: boolean };

/**
 * What the provider does with the stored copy. Signed in with no user id yet: show the copy at
 * once (R17) and wait before touching ownership or sending. If that copy belongs to someone
 * else it can only be left over from a session that ended without a wipe, and a sign-out
 * always wipes it, so showing it briefly is safe. Once the id is known: a different owner (or
 * a queue that dropped another person's changes) clears it immediately.
 */
export function cacheStep(input: {
  signedIn: boolean;
  cacheOwner: string | null;
  userId: string | null;
  queueCleared: boolean;
}): CacheStep {
  if (!input.signedIn) return { show: false, settleOwnership: false, clear: false };
  if (!input.userId) return { show: true, settleOwnership: false, clear: false };
  const clear = ownershipDecision(input.cacheOwner, input.queueCleared, input.userId) === "clear";
  return { show: !clear, settleOwnership: true, clear };
}

/**
 * What goes on screen when the stored copy is loaded. A copy owned by someone other than the
 * known user is not shown (the owner is still reported so the next step clears it); the same
 * user's copy is shown at once (R17). With no known user yet, the copy is shown only if its owner
 * is the user id stored at sign-in.
 */
export function initialView(
  cache: ProjectCache | null,
  userId: string | null,
  storedUserId: string | null = null,
): { owner: string | null; projects: Project[]; currentProjectId: string | null } {
  const owner = cache?.userId || null;
  const step = cacheStep({ signedIn: true, cacheOwner: owner, userId, queueCleared: false });
  // Profile not known yet: only the copy owned by the person whose id was stored at sign-in is
  // shown (a 401 can leave A's copy behind and B can sign in before it is cleared).
  const show = step.show && (userId !== null || (owner !== null && owner === storedUserId));
  if (!cache || !show) return { owner, projects: [], currentProjectId: null };
  return { owner, projects: cache.projects, currentProjectId: cache.currentProjectId };
}

export function ownershipDecision(cacheUserId: string | null, queueCleared: boolean, userId: string): "keep" | "clear" {
  if (queueCleared) return "clear";
  return cacheUserId !== null && cacheUserId !== userId ? "clear" : "keep";
}

/**
 * The owner to save the project cache under: the known owner, else the signed-in user, else the
 * user id stored at sign-in. Never empty; null means no owner can be named, so nothing is saved
 * (an empty owner would make the copy unreadable after a restart).
 */
export function cacheOwnerToSave(
  cacheOwner: string | null,
  userId: string | null,
  storedUserId: string | null,
): string | null {
  return cacheOwner || userId || storedUserId || null;
}
