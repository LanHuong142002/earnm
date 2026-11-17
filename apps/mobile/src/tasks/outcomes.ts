import type { ApiError } from "../lib/api";
import type { Change, ChangeKind } from "../sync/queue";
import { withApplied } from "./optimistic";
import { applyLabelOverlay, applyTaskOverlay } from "./store";
import { CHECKLIST_ENTITY, ITEM_ENTITY, taskProjectId } from "./sync";
import type { Checklist, ChecklistItem, Label, Task } from "./types";

/** Why the server refused a change for good; the notice picks wording from it. */
export type RejectedReason =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "limit"
  | "generic"
  | "labelNameTaken"
  | "labelLimit"
  | "checklistLimit"
  | "itemLimit";
/** What a notice is about when it is not a task: a label, a checklist or one of its items. */
export type NoticeSubject = "label" | "checklist" | "item" | "taskLabels";
export type TaskRejectedNotice = {
  kind: ChangeKind;
  taskTitle: string | null;
  reason: RejectedReason;
  /** Absent for a task. */
  subject?: NoticeSubject;
};

/** The refusal's error code decides first, then its status; anything else is "generic". */
export function reasonFor(error: ApiError): RejectedReason {
  switch (error.code) {
    case "task_limit_reached":
      return "limit";
    case "id_conflict":
      return "conflict";
    case "label_name_taken":
      return "labelNameTaken";
    case "label_limit_reached":
      return "labelLimit";
    case "checklist_limit_reached":
      return "checklistLimit";
    case "item_limit_reached":
      return "itemLimit";
    case "validation_failed":
      return "invalid";
    case "not_found":
      return "not_found";
    case "forbidden":
      return "forbidden";
  }
  if (error.status === 403) return "forbidden";
  if (error.status === 404) return "not_found";
  if (error.status === 409) return "conflict";
  return "generic";
}

/** The cached list after the server accepted `change`, with the changes still waiting replayed on top. */
export function onApplied(list: Task[], change: Change, response: Task | undefined, waiting: Change[]): Task[] {
  return applyTaskOverlay(taskProjectId(change), withApplied(list, change, response), waiting);
}

export type RejectedOutcome = {
  list: Task[];
  notice: TaskRejectedNotice;
  /** The project to fetch again so the server's version replaces the local edit. Always set. */
  refreshProjectId: string;
};

/**
 * What happens when the server refuses `change` for good. A 404 means the task is gone, so it leaves
 * the list. Anything else keeps the list until the refresh restores the server's version. In every
 * case the project is marked for a refresh (a 404 may mean the whole project is gone, which only the
 * refresh can tell).
 */
export function onRejected(list: Task[], change: Change, error: ApiError, waiting: Change[]): RejectedOutcome {
  const known = list.find((t) => t.id === change.entityId)?.title;
  const taskTitle = known ?? (typeof change.data.title === "string" ? change.data.title : null);
  const notice: TaskRejectedNotice = { kind: change.kind, taskTitle, reason: reasonFor(error) };
  const projectId = taskProjectId(change);
  const next = error.status === 404 ? applyTaskOverlay(projectId, list.filter((t) => t.id !== change.entityId), waiting) : list;
  return { list: next, notice, refreshProjectId: projectId };
}

const REASON_KEY: Record<RejectedReason, string> = {
  forbidden: "tasks.reasons.forbidden",
  not_found: "tasks.reasons.notFound",
  conflict: "tasks.reasons.conflict",
  invalid: "tasks.reasons.invalid",
  limit: "tasks.reasons.limit",
  generic: "tasks.reasons.generic",
  labelNameTaken: "tasks.reasons.labelNameTaken",
  labelLimit: "tasks.reasons.labelLimit",
  checklistLimit: "tasks.reasons.checklistLimit",
  itemLimit: "tasks.reasons.itemLimit",
};

const SUBJECT_NOT_FOUND: Record<NoticeSubject, string> = {
  label: "tasks.reasons.labelNotFound",
  checklist: "tasks.reasons.checklistNotFound",
  item: "tasks.reasons.itemNotFound",
  taskLabels: "tasks.reasons.notFound",
};
const SUBJECT_HEADLINE: Record<NoticeSubject, string> = {
  label: "tasks.rejectedLabel",
  checklist: "tasks.rejectedChecklist",
  item: "tasks.rejectedItem",
  taskLabels: "tasks.rejectedTaskLabels",
};

/** i18n keys for a refused-change notice. Only the creator or an Owner can delete, so a refused delete says that. */
export function noticeKeys(notice: TaskRejectedNotice): { headline: string; reason: string } {
  if (notice.subject) {
    let reason = REASON_KEY[notice.reason];
    if (notice.reason === "not_found") reason = SUBJECT_NOT_FOUND[notice.subject];
    if (notice.subject === "label" && notice.kind === "delete" && notice.reason === "forbidden") {
      reason = "tasks.reasons.labelForbiddenDelete";
    }
    if (notice.subject === "taskLabels" && notice.taskTitle === null) {
      return { headline: "tasks.rejectedTaskLabelsNoTitle", reason };
    }
    return { headline: SUBJECT_HEADLINE[notice.subject], reason };
  }
  const named = notice.taskTitle !== null;
  let reason = REASON_KEY[notice.reason];
  if (notice.kind === "delete" && notice.reason === "forbidden") reason = "tasks.reasons.forbiddenDelete";
  // A refused create answered 404 means the project is gone; there is no task yet to have "disappeared".
  if (notice.kind === "create" && notice.reason === "not_found") reason = "tasks.reasons.projectGone";
  if (notice.kind === "create") return { headline: named ? "tasks.rejectedCreate" : "tasks.rejectedCreateNoTitle", reason };
  return { headline: named ? "tasks.rejected" : "tasks.rejectedNoTitle", reason };
}

/** `list` with the checklist or item a change names replaced by the server's copy, or removed for a delete. */
function replaceChild(list: Task[], change: Change, response: unknown): Task[] {
  const taskId = String(change.data.taskId);
  const checklistId = change.entity === CHECKLIST_ENTITY ? change.entityId : String(change.data.checklistId);
  return list.map((task) => {
    if (task.id !== taskId) return task;
    if (change.entity === CHECKLIST_ENTITY) {
      if (change.kind === "delete") return { ...task, checklists: task.checklists.filter((c) => c.id !== change.entityId) };
      const checklist = response as Checklist;
      const has = task.checklists.some((c) => c.id === checklist.id);
      return {
        ...task,
        checklists: has ? task.checklists.map((c) => (c.id === checklist.id ? checklist : c)) : [...task.checklists, checklist],
      };
    }
    return {
      ...task,
      checklists: task.checklists.map((c) => {
        if (c.id !== checklistId) return c;
        if (change.kind === "delete") return { ...c, items: c.items.filter((i) => i.id !== change.entityId) };
        const item = response as ChecklistItem;
        const has = c.items.some((i) => i.id === item.id);
        return { ...c, items: has ? c.items.map((i) => (i.id === item.id ? item : i)) : [...c.items, item] };
      }),
    };
  });
}

/** The cached tasks after the server accepted a checklist or item change, with the waiting changes replayed on top. */
export function onChildApplied(list: Task[], change: Change, response: unknown, waiting: Change[]): Task[] {
  return applyTaskOverlay(taskProjectId(change), replaceChild(list, change, response), waiting);
}

/**
 * A refused checklist or item change (R15). On 404, or a refused create, the thing leaves the local
 * copy; otherwise the copy stays until the refresh puts back the server version. The project is
 * always marked for that refresh.
 */
export function onChildRejected(list: Task[], change: Change, error: ApiError, waiting: Change[]): RejectedOutcome {
  const subject: NoticeSubject = change.entity === ITEM_ENTITY ? "item" : "checklist";
  const projectId = taskProjectId(change);
  const taskTitle = list.find((t) => t.id === String(change.data.taskId))?.title ?? null;
  const notice: TaskRejectedNotice = { kind: change.kind, taskTitle, reason: reasonFor(error), subject };
  const gone = error.status === 404 || change.kind === "create";
  const next = gone ? applyTaskOverlay(projectId, replaceChild(list, { ...change, kind: "delete" }, undefined), waiting) : list;
  return { list: next, notice, refreshProjectId: projectId };
}

/** The cached labels after the server accepted a label change, with the waiting label changes replayed on top. */
export function onLabelApplied(labels: Label[], change: Change, response: unknown, waiting: Change[]): Label[] {
  const projectId = taskProjectId(change);
  let next = labels.filter((l) => l.id !== change.entityId);
  if (change.kind !== "delete" && response) {
    const server = { ...(response as Label), projectId };
    const index = labels.findIndex((l) => l.id === change.entityId);
    next = index >= 0 ? labels.map((l, i) => (i === index ? server : l)) : [...labels, server];
  }
  return applyLabelOverlay(projectId, next, waiting);
}

export type LabelRejectedOutcome = RejectedOutcome & {
  labels: Label[];
  /** Set when the label is gone for good: waiting task-label changes must lose it too (R15). */
  removedLabelId: string | null;
};

/**
 * A refused label change. A refused create (duplicate name, limit) or a 404 removes the label from the
 * local copy and from every cached task. Anything else keeps the copy until the refresh.
 */
export function onLabelRejected(
  labels: Label[],
  tasks: Task[],
  change: Change,
  error: ApiError,
  waiting: Change[],
): LabelRejectedOutcome {
  const projectId = taskProjectId(change);
  const notice: TaskRejectedNotice = { kind: change.kind, taskTitle: null, reason: reasonFor(error), subject: "label" };
  const gone = error.status === 404 || change.kind === "create";
  if (!gone) return { list: tasks, labels, notice, refreshProjectId: projectId, removedLabelId: null };
  const id = change.entityId;
  const nextTasks = tasks.map((t) => (t.labelIds.includes(id) ? { ...t, labelIds: t.labelIds.filter((l) => l !== id) } : t));
  return {
    list: applyTaskOverlay(projectId, nextTasks, waiting),
    labels: applyLabelOverlay(projectId, labels.filter((l) => l.id !== id), waiting),
    notice,
    refreshProjectId: projectId,
    removedLabelId: id,
  };
}
