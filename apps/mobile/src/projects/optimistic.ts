import type { Change } from "../sync/queue";
import type { Project, ProjectField } from "./api";
import { validateProjectInput, type ProjectInput, type ProjectInputErrors } from "./store";

const FIELDS: ProjectField[] = ["name", "description", "currency"];

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
  fields: Partial<ProjectInput>,
): { ok: true; changed: Partial<Pick<Project, ProjectField>> } | { ok: false; errors: ProjectInputErrors } {
  const result = validateProjectInput({
    name: fields.name ?? current.name,
    description: fields.description ?? current.description,
    currency: fields.currency ?? current.currency,
  });
  if (!result.ok) return result;
  const changed: Record<string, unknown> = {};
  for (const field of FIELDS) if (fields[field] !== undefined) changed[field] = result.value[field];
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
export function ownershipDecision(cacheUserId: string | null, queueCleared: boolean, userId: string): "keep" | "clear" {
  if (queueCleared) return "clear";
  return cacheUserId !== null && cacheUserId !== userId ? "clear" : "keep";
}
