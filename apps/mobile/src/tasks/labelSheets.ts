import type { LabelColour } from "../theme/tokens";
import type { Label } from "./types";
import { isDuplicateLabelName, LABELS_PER_TASK_MAX, validateLabelName } from "./validate";

/** The eight fixed colours, in the order the picker shows them. */
export const LABEL_COLOURS: readonly LabelColour[] = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple"];

/** Tap a label in the picker: remove it, or add it unless the task already has the most. */
export function toggleTaskLabel(current: readonly string[], id: string): { ids: string[]; limit: boolean } {
  if (current.includes(id)) return { ids: current.filter((x) => x !== id), limit: false };
  if (current.length >= LABELS_PER_TASK_MAX) return { ids: [...current], limit: true };
  return { ids: [...current, id], limit: false };
}

export function toggleFilterLabel(current: readonly string[], id: string): string[] {
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}

export type LabelFormState = { valid: boolean; error: string | null; name: string | null };

/**
 * What the label form shows for the typed name. `error` is an i18n key. An empty name stays quiet
 * until `touched`, so a fresh form isn't red.
 */
export function labelFormState(
  raw: string,
  labels: readonly Label[],
  exceptId: string | undefined,
  touched = false,
): LabelFormState {
  const result = validateLabelName(raw);
  if (!result.ok) {
    const quiet = result.error === "tasks.errors.labelNameRequired" && !touched;
    return { valid: false, error: quiet ? null : result.error, name: null };
  }
  if (isDuplicateLabelName(result.value, labels, exceptId)) {
    return { valid: false, error: "tasks.labels.duplicate", name: null };
  }
  return { valid: true, error: null, name: result.value };
}
