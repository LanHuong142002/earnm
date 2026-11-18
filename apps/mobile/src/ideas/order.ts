import type { Idea } from "./types";

function created(idea: Idea): number {
  const t = Date.parse(idea.createdAt);
  return Number.isNaN(t) ? 0 : t;
}

/** Highest score first, then the newest; the id breaks a tie so the order never jumps. */
function byScore(a: Idea, b: Idea): number {
  if (a.score !== b.score) return b.score - a.score;
  const time = created(b) - created(a);
  if (time !== 0) return time;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The ideas board order (spec R17): ideas that are still in play by score (high to low) and then newest first;
 * dropped ideas come back separately, in the same order, for the collapsed "Đã bỏ" section at the end.
 */
export function orderIdeas(ideas: Idea[]): { open: Idea[]; dropped: Idea[] } {
  const open = ideas.filter((i) => i.status !== "dropped").sort(byScore);
  const dropped = ideas.filter((i) => i.status === "dropped").sort(byScore);
  return { open, dropped };
}
