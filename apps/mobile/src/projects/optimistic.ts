import type { Change } from "../sync/queue";
import type { Project, ProjectField } from "./api";

const FIELDS: ProjectField[] = ["name", "description", "currency"];

/** Only the fields whose value differs from the current project. */
export function changedFields(
  current: Project,
  next: Partial<Pick<Project, ProjectField>>,
): Partial<Pick<Project, ProjectField>> {
  const out: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (field in next && next[field] !== undefined && next[field] !== current[field]) out[field] = next[field];
  }
  return out as Partial<Pick<Project, ProjectField>>;
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
