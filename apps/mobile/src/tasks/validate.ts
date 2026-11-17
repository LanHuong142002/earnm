import { cleanMultiLine, cleanSingleLine } from "../lib/text";
import { TASK_STATUSES, type TaskStatus } from "./types";

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const ASSIGNEES_MAX = 20;

export type TaskInput = {
  title: string;
  description: string;
  status: string;
  dueDate: string | null;
  dueTime: string | null;
  assigneeIds: string[];
};

/** Values are i18n keys, one message per field (spec R27). */
export type TaskInputErrors = {
  title?: "tasks.errors.titleRequired" | "tasks.errors.titleTooLong";
  description?: "tasks.errors.descriptionTooLong";
  status?: "tasks.errors.statusInvalid";
  dueDate?: "tasks.errors.dueDateInvalid" | "tasks.errors.dueDatePast";
  dueTime?: "tasks.errors.dueTimeInvalid" | "tasks.errors.dueTimeNeedsDate" | "tasks.errors.dueTimePast";
  assignees?: "tasks.errors.assigneesTooMany" | "tasks.errors.assigneesDuplicate";
};

export type TaskValidation =
  | {
      ok: true;
      value: {
        title: string;
        description: string;
        status: TaskStatus;
        dueDate: string | null;
        dueTime: string | null;
        assigneeIds: string[];
      };
    }
  | { ok: false; errors: TaskInputErrors };

function isRealDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (y < 1900 || y > 9999) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Same limits as the server (spec R1-R3). */
export function validateTaskInput(input: TaskInput): TaskValidation {
  const title = cleanSingleLine(input.title);
  const description = cleanMultiLine(input.description);
  const errors: TaskInputErrors = {};

  if (title.length === 0) errors.title = "tasks.errors.titleRequired";
  else if (title.length > TITLE_MAX) errors.title = "tasks.errors.titleTooLong";
  if (description.length > DESCRIPTION_MAX) errors.description = "tasks.errors.descriptionTooLong";
  if (!(TASK_STATUSES as readonly string[]).includes(input.status)) errors.status = "tasks.errors.statusInvalid";

  if (input.dueDate !== null && !isRealDay(input.dueDate)) errors.dueDate = "tasks.errors.dueDateInvalid";
  if (input.dueTime !== null) {
    if (input.dueDate === null) errors.dueTime = "tasks.errors.dueTimeNeedsDate";
    else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.dueTime)) errors.dueTime = "tasks.errors.dueTimeInvalid";
  }

  if (new Set(input.assigneeIds).size !== input.assigneeIds.length) errors.assignees = "tasks.errors.assigneesDuplicate";
  else if (input.assigneeIds.length > ASSIGNEES_MAX) errors.assignees = "tasks.errors.assigneesTooMany";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      description,
      status: input.status as TaskStatus,
      dueDate: input.dueDate,
      dueTime: input.dueTime,
      assigneeIds: [...input.assigneeIds],
    },
  };
}

export const CHECKLIST_NAME_MAX = 60;
export const CHECKLIST_ITEM_TEXT_MAX = 200;
export const LABEL_NAME_MAX = 30;
export const CHECKLISTS_PER_TASK_MAX = 10;
export const ITEMS_PER_CHECKLIST_MAX = 50;
export const LABELS_PER_PROJECT_MAX = 50;
export const LABELS_PER_TASK_MAX = 10;

export type TextValidation<E extends string> = { ok: true; value: string } | { ok: false; error: E };

function validateText<E extends string>(raw: string, max: number, required: E, tooLong: E): TextValidation<E> {
  const value = cleanSingleLine(raw);
  if (value.length === 0) return { ok: false, error: required };
  if (value.length > max) return { ok: false, error: tooLong };
  return { ok: true, value };
}

export const validateChecklistName = (raw: string) =>
  validateText(raw, CHECKLIST_NAME_MAX, "tasks.errors.checklistNameRequired", "tasks.errors.checklistNameTooLong");

export const validateItemText = (raw: string) =>
  validateText(raw, CHECKLIST_ITEM_TEXT_MAX, "tasks.errors.itemTextRequired", "tasks.errors.itemTextTooLong");

export const validateLabelName = (raw: string) =>
  validateText(raw, LABEL_NAME_MAX, "tasks.errors.labelNameRequired", "tasks.errors.labelNameTooLong");

/** The server's comparison: trimmed, Unicode NFC, case-folded. */
const labelKey = (name: string) => name.trim().normalize("NFC").toLowerCase();

/** True when another label (not `exceptId`) already has this name. */
export function isDuplicateLabelName(
  name: string,
  labels: readonly { id: string; name: string }[],
  exceptId?: string,
): boolean {
  const key = labelKey(name);
  return labels.some((l) => l.id !== exceptId && labelKey(l.name) === key);
}
