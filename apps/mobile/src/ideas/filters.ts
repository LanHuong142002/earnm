import type { Label } from "../tasks/types";
import type { Idea, IdeaStatus } from "./types";

/** The pills of the board: all, or one status (dropped ideas live in their own section, not in a pill). */
export type IdeaStatusFilter = "all" | Exclude<IdeaStatus, "dropped">;

export type IdeaFilters = { status: IdeaStatusFilter; labelIds: string[] };

export const DEFAULT_IDEA_FILTERS: IdeaFilters = { status: "all", labelIds: [] };

/**
 * Every chosen condition must hold (spec R17). Returns a new array in the input order. With a status pill chosen
 * dropped ideas are left out; with "all" they stay, for the collapsed section. `labels` is the project's label
 * list: chosen label ids that are not in it (a deleted label) are ignored, and when none is left there is no
 * label filter.
 */
export function filterIdeas(ideas: Idea[], filters: IdeaFilters, labels: readonly Pick<Label, "id">[] = []): Idea[] {
  const known = new Set(labels.map((l) => l.id));
  const chosen = filters.labelIds.filter((id) => known.has(id));
  return ideas.filter((idea) => {
    if (filters.status !== "all" && idea.status !== filters.status) return false;
    if (chosen.length > 0 && !idea.labelIds.some((id) => chosen.includes(id))) return false;
    return true;
  });
}
