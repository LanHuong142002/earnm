import { taskProgress, type Progress } from "./progress";
import type { Task } from "./types";
import { CHECKLISTS_PER_TASK_MAX, ITEMS_PER_CHECKLIST_MAX, validateItemText } from "./validate";

/** Total progress for the "Checklist" heading ("3/7 mục xong"), or null with no items. */
export function checklistSummary(task: { checklists: readonly { items: readonly { done: boolean }[] }[] }): Progress | null {
  return taskProgress(task as Pick<Task, "checklists">);
}

/** Width of the 4px bar, in whole percent. */
export function barPercent(progress: Progress | null): number {
  return progress === null ? 0 : Math.round((progress.done / progress.total) * 100);
}

export const canAddChecklist = (count: number) => count < CHECKLISTS_PER_TASK_MAX;
export const canAddItem = (count: number) => count < ITEMS_PER_CHECKLIST_MAX;

export type ItemOutcome =
  | { kind: "add"; text: string; keepOpen: boolean }
  | { kind: "save"; text: string }
  | { kind: "error"; error: string }
  | { kind: "close" };

/** What the "add item" input does on Return (stays open for the next one) or on blur. */
export function newItemOutcome(raw: string, source: "submit" | "blur"): ItemOutcome {
  if (source === "blur" && raw.trim() === "") return { kind: "close" };
  const result = validateItemText(raw);
  if (!result.ok) return { kind: "error", error: result.error };
  return { kind: "add", text: result.value, keepOpen: source === "submit" };
}

/** What the inline item editor does: unchanged closes; empty keeps the old text (error on Return only). */
export function editItemOutcome(old: string, raw: string, source: "submit" | "blur"): ItemOutcome {
  if (raw.trim() === "") return source === "blur" ? { kind: "close" } : { kind: "error", error: "tasks.errors.itemTextRequired" };
  const result = validateItemText(raw);
  if (!result.ok) return { kind: "error", error: result.error };
  return result.value === old.trim() ? { kind: "close" } : { kind: "save", text: result.value };
}
