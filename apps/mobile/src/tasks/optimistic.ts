import type { Change, NewChange } from "../sync/queue";
import { TASK_ENTITY } from "./sync";
import { validateTaskInput, type TaskInput, type TaskInputErrors } from "./validate";
import type { Task, TaskAssignee } from "./types";

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
