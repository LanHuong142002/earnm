import type { Change, NewChange } from "../sync/queue";
import type { LabelColour } from "../theme/tokens";
import { CHECKLIST_ENTITY, ITEM_ENTITY, LABEL_ENTITY, TASK_ENTITY, TASK_LABELS_ENTITY } from "./sync";
import {
  CHECKLISTS_PER_TASK_MAX,
  ITEMS_PER_CHECKLIST_MAX,
  LABELS_PER_PROJECT_MAX,
  LABELS_PER_TASK_MAX,
  isDuplicateLabelName,
  validateChecklistName,
  validateItemText,
  validateLabelName,
  validateTaskInput,
  type TaskInput,
  type TaskInputErrors,
} from "./validate";
import type { Checklist, ChecklistItem, Label, Task, TaskAssignee } from "./types";

/** What a form hands over: only the fields the person touched. `null` for dueDate or dueTime clears it. */
export type TaskEdit = Partial<{
  title: string;
  description: string;
  status: string;
  dueDate: string | null;
  dueTime: string | null;
  assigneeIds: string[];
}>;

function namesOf(ids: string[], members: TaskAssignee[], existing: TaskAssignee[] = []): Record<string, string> {
  const names: Record<string, string> = {};
  for (const id of ids) {
    const known = members.find((m) => m.id === id) ?? existing.find((a) => a.id === id);
    if (known) names[id] = known.displayName;
  }
  return names;
}

export type PlanCreate =
  | { ok: true; change: NewChange }
  | { ok: false; errors: TaskInputErrors };

/** Validates a new task and builds the create change: every field, all stamped `now`. */
export function planTaskCreate(args: {
  id: string;
  projectId: string;
  userId: string;
  input: TaskInput;
  members: TaskAssignee[];
  now: Date;
}): PlanCreate {
  const result = validateTaskInput(args.input);
  if (!result.ok) return result;
  const v = result.value;
  const at = args.now.toISOString();
  const data = {
    projectId: args.projectId,
    title: v.title,
    description: v.description,
    status: v.status,
    due: v.dueDate ? { date: v.dueDate, time: v.dueTime } : null,
    assignees: v.assigneeIds,
    assigneeNames: namesOf(v.assigneeIds, args.members),
    createdById: args.userId,
  };
  const fieldTimes: Record<string, string> = {};
  for (const key of Object.keys(data)) fieldTimes[key] = at;
  return { ok: true, change: { entity: TASK_ENTITY, entityId: args.id, kind: "create", data, fieldTimes } };
}

export type PlanUpdate =
  | { ok: true; change: NewChange | null }
  | { ok: false; errors: TaskInputErrors };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Validates an edit (the merged result against the cached task) and returns an update holding
 * exactly the fields whose value changed, each with its own time (`now`). Fields not touched are never
 * sent, so a refresh that changed them meanwhile is not reverted. `change: null` means nothing changed.
 */
export function planTaskUpdate(current: Task, edit: TaskEdit, members: TaskAssignee[], now: Date): PlanUpdate {
  const dueDate = edit.dueDate !== undefined ? edit.dueDate : current.dueDate;
  // Clearing the day without saying anything about the time clears the time too.
  const dueTime = edit.dueTime !== undefined ? edit.dueTime : edit.dueDate === null ? null : current.dueTime;
  const result = validateTaskInput({
    title: edit.title ?? current.title,
    description: edit.description ?? current.description,
    status: edit.status ?? current.status,
    dueDate,
    dueTime,
    assigneeIds: edit.assigneeIds ?? current.assignees.map((a) => a.id),
  });
  if (!result.ok) return result;
  const v = result.value;

  const data: Record<string, unknown> = { projectId: current.projectId };
  const fields: string[] = [];
  const touch = (field: string, value: unknown) => {
    data[field] = value;
    fields.push(field);
  };
  if (edit.title !== undefined && v.title !== current.title) touch("title", v.title);
  if (edit.description !== undefined && v.description !== current.description) touch("description", v.description);
  if (edit.status !== undefined && v.status !== current.status) touch("status", v.status);
  if ((edit.dueDate !== undefined || edit.dueTime !== undefined) && (v.dueDate !== current.dueDate || v.dueTime !== current.dueTime)) {
    touch("due", v.dueDate ? { date: v.dueDate, time: v.dueTime } : null);
  }
  if (edit.assigneeIds !== undefined && !sameSet(v.assigneeIds, current.assignees.map((a) => a.id))) {
    touch("assignees", v.assigneeIds);
    data.assigneeNames = namesOf(v.assigneeIds, members, current.assignees);
    fields.push("assigneeNames");
  }
  if (fields.length === 0) return { ok: true, change: null };

  const at = now.toISOString();
  const fieldTimes: Record<string, string> = { projectId: at };
  for (const field of fields) fieldTimes[field] = at;
  return { ok: true, change: { entity: TASK_ENTITY, entityId: current.id, kind: "update", data, fieldTimes } };
}

/** The delete change; the title rides along so a refusal can still name the task. */
export function planTaskDelete(task: Task): NewChange {
  return { entity: TASK_ENTITY, entityId: task.id, kind: "delete", data: { projectId: task.projectId, title: task.title } };
}

/** The cache after the server accepted `change`: its returned task in, or the task out for a delete. */
export function withApplied(list: Task[], change: Change, response: Task | undefined): Task[] {
  if (change.kind === "delete" || !response) return list.filter((t) => t.id !== change.entityId);
  const index = list.findIndex((t) => t.id === response.id);
  if (index < 0) return [...list, response];
  return list.map((t, i) => (i === index ? response : t));
}

/**
 * Plans for labels, checklists and items. Each validates with the same limits as the server and
 * returns an i18n key as `error` when it refuses; `change: null` means nothing differs. Every field
 * a plan sends has its own time (`now`), so a field not touched is never sent.
 */
export type PlanResult = { ok: true; change: NewChange | null } | { ok: false; error: string };

const stamp = (data: Record<string, unknown>, now: Date): Record<string, string> =>
  Object.fromEntries(Object.keys(data).map((key) => [key, now.toISOString()]));

export function planLabelCreate(args: {
  id: string;
  projectId: string;
  name: string;
  colour: LabelColour;
  labels: Label[];
  now: Date;
}): PlanResult {
  const name = validateLabelName(args.name);
  if (!name.ok) return name;
  if (isDuplicateLabelName(name.value, args.labels)) return { ok: false, error: "tasks.errors.labelNameDuplicate" };
  if (args.labels.length >= LABELS_PER_PROJECT_MAX) return { ok: false, error: "tasks.errors.labelLimit" };
  const data = { projectId: args.projectId, name: name.value, colour: args.colour };
  return {
    ok: true,
    change: { entity: LABEL_ENTITY, entityId: args.id, kind: "create", data, fieldTimes: stamp(data, args.now) },
  };
}

export function planLabelUpdate(
  current: Label,
  projectId: string,
  edit: { name?: string; colour?: LabelColour },
  labels: Label[],
  now: Date,
): PlanResult {
  const data: Record<string, unknown> = { projectId };
  if (edit.name !== undefined) {
    const name = validateLabelName(edit.name);
    if (!name.ok) return name;
    if (isDuplicateLabelName(name.value, labels, current.id)) return { ok: false, error: "tasks.errors.labelNameDuplicate" };
    if (name.value !== current.name) data.name = name.value;
  }
  if (edit.colour !== undefined && edit.colour !== current.colour) data.colour = edit.colour;
  if (Object.keys(data).length === 1) return { ok: true, change: null };
  return { ok: true, change: { entity: LABEL_ENTITY, entityId: current.id, kind: "update", data, fieldTimes: stamp(data, now) } };
}

export function planLabelDelete(label: Label, projectId: string): NewChange {
  return { entity: LABEL_ENTITY, entityId: label.id, kind: "delete", data: { projectId, name: label.name } };
}

/** The whole set of labels on a task; every id must be one of the project's labels. */
export function planSetTaskLabels(task: Task, labelIds: string[], labels: Label[], now: Date): PlanResult {
  const unique = [...new Set(labelIds)];
  if (unique.length > LABELS_PER_TASK_MAX) return { ok: false, error: "tasks.errors.labelsPerTaskLimit" };
  const known = new Set(labels.map((l) => l.id));
  const next = unique.filter((id) => known.has(id));
  const same = next.length === task.labelIds.length && next.every((id) => task.labelIds.includes(id));
  if (same) return { ok: true, change: null };
  const data = { projectId: task.projectId, labels: next };
  return { ok: true, change: { entity: TASK_LABELS_ENTITY, entityId: task.id, kind: "update", data, fieldTimes: stamp(data, now) } };
}

export function planChecklistCreate(args: { id: string; task: Task; name: string; now: Date }): PlanResult {
  const name = validateChecklistName(args.name);
  if (!name.ok) return name;
  if (args.task.checklists.length >= CHECKLISTS_PER_TASK_MAX) return { ok: false, error: "tasks.errors.checklistLimit" };
  const data = { projectId: args.task.projectId, taskId: args.task.id, name: name.value };
  return {
    ok: true,
    change: { entity: CHECKLIST_ENTITY, entityId: args.id, kind: "create", data, fieldTimes: stamp(data, args.now) },
  };
}

export function planChecklistRename(task: Task, checklist: Checklist, rawName: string, now: Date): PlanResult {
  const name = validateChecklistName(rawName);
  if (!name.ok) return name;
  if (name.value === checklist.name) return { ok: true, change: null };
  const data = { projectId: task.projectId, taskId: task.id, name: name.value };
  return { ok: true, change: { entity: CHECKLIST_ENTITY, entityId: checklist.id, kind: "update", data, fieldTimes: stamp(data, now) } };
}

export function planChecklistDelete(task: Task, checklist: Checklist): NewChange {
  return {
    entity: CHECKLIST_ENTITY,
    entityId: checklist.id,
    kind: "delete",
    data: { projectId: task.projectId, taskId: task.id, name: checklist.name },
  };
}

export function planItemCreate(args: { id: string; task: Task; checklist: Checklist; text: string; now: Date }): PlanResult {
  const text = validateItemText(args.text);
  if (!text.ok) return text;
  if (args.checklist.items.length >= ITEMS_PER_CHECKLIST_MAX) return { ok: false, error: "tasks.errors.itemLimit" };
  const data = {
    projectId: args.task.projectId,
    taskId: args.task.id,
    checklistId: args.checklist.id,
    text: text.value,
    done: false,
  };
  return {
    ok: true,
    change: { entity: ITEM_ENTITY, entityId: args.id, kind: "create", data, fieldTimes: stamp(data, args.now) },
  };
}

/** Only the fields that differ are sent, each with its own time: ticking sends `done` alone. */
export function planItemEdit(
  task: Task,
  checklist: Checklist,
  item: ChecklistItem,
  edit: { text?: string; done?: boolean },
  now: Date,
): PlanResult {
  const data: Record<string, unknown> = { projectId: task.projectId, taskId: task.id, checklistId: checklist.id };
  const keys = Object.keys(data);
  if (edit.text !== undefined) {
    const text = validateItemText(edit.text);
    if (!text.ok) return text;
    if (text.value !== item.text) data.text = text.value;
  }
  if (edit.done !== undefined && edit.done !== item.done) data.done = edit.done;
  if (Object.keys(data).length === keys.length) return { ok: true, change: null };
  return { ok: true, change: { entity: ITEM_ENTITY, entityId: item.id, kind: "update", data, fieldTimes: stamp(data, now) } };
}

export function planItemDelete(task: Task, checklist: Checklist, item: ChecklistItem): NewChange {
  return {
    entity: ITEM_ENTITY,
    entityId: item.id,
    kind: "delete",
    data: { projectId: task.projectId, taskId: task.id, checklistId: checklist.id },
  };
}
