import type { Member } from "../lib/api";
import type { TaskAssignee } from "./types";
import { ASSIGNEES_MAX } from "./validate";

/** The project members as the people a task can name. */
export function membersToAssignees(members: Member[]): TaskAssignee[] {
  return members.map((m) => ({ id: m.userId, displayName: m.displayName }));
}

/**
 * The chosen ids with `id` added or removed. A person past the limit is not added and `tooMany`
 * says so; taking someone off always works. `addable` false (someone who left the project) never adds.
 */
export function toggleAssignee(ids: string[], id: string, addable = true): { ids: string[]; tooMany: boolean } {
  if (ids.includes(id)) return { ids: ids.filter((x) => x !== id), tooMany: false };
  if (!addable) return { ids, tooMany: false };
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

/** A person the picker shows; `former` is someone already assigned who is no longer a member. */
export type AssigneeOption = TaskAssignee & { former: boolean };

/**
 * The picker's rows (R27). With the server's member list (`members`) only current members are
 * offered, plus assigned people missing from it (named from `known`), marked `former`: they can be
 * taken off but not put back. With no list ever fetched (null) it is everyone `known`.
 */
export function buildAssigneeOptions({
  members,
  known,
  selectedIds,
}: {
  members: Member[] | null;
  known: TaskAssignee[];
  selectedIds: string[];
}): AssigneeOption[] {
  if (members === null) return known.map((p) => ({ ...p, former: false }));
  const current = membersToAssignees(members);
  const currentIds = new Set(current.map((p) => p.id));
  const former = known.filter((p) => selectedIds.includes(p.id) && !currentIds.has(p.id));
  return [...current.map((p) => ({ ...p, former: false })), ...former.map((p) => ({ ...p, former: true }))];
}
