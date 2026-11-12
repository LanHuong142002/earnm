import type { Member } from "../lib/api";
import type { TaskAssignee } from "./types";
import { ASSIGNEES_MAX } from "./validate";

/** The project members as the people a task can name. */
export function membersToAssignees(members: Member[]): TaskAssignee[] {
  return members.map((m) => ({ id: m.userId, displayName: m.displayName }));
}

/**
 * The chosen ids with `id` added or removed. A person past the limit is not added and `tooMany`
 * says so; taking someone off always works.
 */
export function toggleAssignee(ids: string[], id: string): { ids: string[]; tooMany: boolean } {
  if (ids.includes(id)) return { ids: ids.filter((x) => x !== id), tooMany: false };
  if (ids.length >= ASSIGNEES_MAX) return { ids, tooMany: true };
  return { ids: [...ids, id], tooMany: false };
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

/** "An, Binh": first names of the chosen people, in the order of `people`. Empty for nobody. */
export function assigneeSummary(ids: string[], people: TaskAssignee[]): string {
  const chosen = new Set(ids);
  return people
    .filter((p) => chosen.has(p.id))
    .map((p) => firstName(p.displayName))
    .join(", ");
}
