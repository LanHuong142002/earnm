import type { Label } from "./types";

/** Chips shown on a card before "+n". */
export const CHIPS_SHOWN = 3;

/** A task's labels in its own order; ids that are not in the project's labels (deleted) are skipped. */
export function resolveLabels(labelIds: readonly string[], labels: readonly Label[]): Label[] {
  const byId = new Map(labels.map((l) => [l.id, l]));
  const out: Label[] = [];
  for (const id of labelIds) {
    const label = byId.get(id);
    if (label) out.push(label);
  }
  return out;
}

export function splitChips<T>(labels: readonly T[]): { shown: T[]; extra: number } {
  return { shown: labels.slice(0, CHIPS_SHOWN), extra: Math.max(0, labels.length - CHIPS_SHOWN) };
}

/** Names of the chosen labels (in the project's order) for the filter row, or null when none is chosen. */
export function labelSummary(chosenIds: readonly string[], labels: readonly Label[]): string | null {
  const chosen = new Set(chosenIds);
  const names = labels.filter((l) => chosen.has(l.id)).map((l) => l.name);
  return names.length === 0 ? null : names.join(", ");
}
