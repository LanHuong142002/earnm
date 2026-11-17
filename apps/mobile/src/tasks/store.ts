import type { Change } from "../sync/queue";
import type { KeyValueStore } from "../sync/storage";
import { CHECKLIST_ENTITY, ITEM_ENTITY, LABEL_ENTITY, TASK_ENTITY, TASK_LABELS_ENTITY } from "./sync";
import { DEFAULT_FILTERS, type TaskFilters } from "./filters";
import { TASK_STATUSES, type Checklist, type ChecklistItem, type Label, type Task, type TaskAssignee } from "./types";

// Kept at v1: a copy saved before labels and checklists existed still reads (isTask, isFilters and
// readTaskCache fill in what it lacks), so nobody's tasks are thrown away and fetched again.
const CACHE_KEY = "tasks.cache.v1";

export type TaskCache = {
  ownerId: string;
  byProject: Record<string, Task[]>;
  /** Each project's labels (spec R5). */
  labelsByProject: Record<string, Label[]>;
  filters: Record<string, TaskFilters>;
};

export function emptyTaskCache(ownerId: string): TaskCache {
  return { ownerId, byProject: {}, labelsByProject: {}, filters: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    (TASK_STATUSES as readonly unknown[]).includes(value.status) &&
    (value.dueDate === null || typeof value.dueDate === "string") &&
    (value.dueTime === null || typeof value.dueTime === "string") &&
    Array.isArray(value.assignees) &&
    value.assignees.every((a) => isRecord(a) && typeof a.id === "string" && typeof a.displayName === "string") &&
    (value.createdById === null || typeof value.createdById === "string") &&
    typeof value.createdAt === "string" &&
    // Copies saved before labels and checklists existed have neither; readTaskCache fills them in.
    (value.labelIds === undefined || isStringArray(value.labelIds)) &&
    (value.checklists === undefined || (Array.isArray(value.checklists) && value.checklists.every(isChecklist)))
  );
}

function isChecklistItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    typeof value.done === "boolean" &&
    (value.createdAt === undefined || typeof value.createdAt === "string")
  );
}

// A malformed checklist makes the whole task untrusted (like any other bad field): a cached copy is
// dropped and fetched again, a server task is skipped until the next refresh.
function isChecklist(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.createdAt === undefined || typeof value.createdAt === "string") &&
    Array.isArray(value.items) &&
    value.items.every(isChecklistItem)
  );
}

const LABEL_COLOURS: readonly unknown[] = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple"];

export function isLabel(value: unknown): value is Label {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    LABEL_COLOURS.includes(value.colour) &&
    (value.projectId === undefined || typeof value.projectId === "string")
  );
}

function isFilters(value: unknown): value is TaskFilters {
  return (
    isRecord(value) &&
    (value.status === "all" || (TASK_STATUSES as readonly unknown[]).includes(value.status)) &&
    typeof value.mine === "boolean" &&
    // Copies saved before "only me" existed have no onlyMe; they load with it off.
    (value.onlyMe === undefined || typeof value.onlyMe === "boolean") &&
    typeof value.dueSoon === "boolean" &&
    // Copies saved before labels existed have no labelIds; they load with no label filter.
    (value.labelIds === undefined || isStringArray(value.labelIds))
  );
}

function withDefaults(filters: Record<string, Partial<TaskFilters>>): Record<string, TaskFilters> {
  return Object.fromEntries(Object.entries(filters).map(([id, f]) => [id, { ...DEFAULT_FILTERS, ...f }]));
}

async function readTaskCache(store: KeyValueStore): Promise<TaskCache | null> {
  let saved: unknown;
  try {
    saved = await store.getJSON<unknown>(CACHE_KEY);
  } catch {
    return null;
  }
  if (!isRecord(saved) || typeof saved.ownerId !== "string" || saved.ownerId === "") return null;
  if (!isRecord(saved.byProject) || !isRecord(saved.filters)) return null;
  for (const list of Object.values(saved.byProject)) {
    if (!Array.isArray(list) || !list.every(isTask)) return null;
  }
  if (!Object.values(saved.filters).every(isFilters)) return null;
  // Copies saved before labels existed have no labelsByProject; they load with none.
  const savedLabels = saved.labelsByProject === undefined ? {} : saved.labelsByProject;
  if (!isRecord(savedLabels)) return null;
  for (const list of Object.values(savedLabels)) {
    if (!Array.isArray(list) || !list.every(isLabel)) return null;
  }
  // Older copies also hold membersByProject; members live in the members cache now, so it is ignored.
  return {
    ownerId: saved.ownerId,
    byProject: Object.fromEntries(
      Object.entries(saved.byProject).map(([id, list]) => [
        id,
        (list as Partial<Task>[]).map((t) => ({ labelIds: [], checklists: [], ...t }) as Task),
      ]),
    ),
    labelsByProject: savedLabels as Record<string, Label[]>,
    filters: withDefaults(saved.filters as Record<string, Partial<TaskFilters>>),
  };
}

/** The stored copy, or null when there is none, it is unreadable, or it belongs to someone else. */
export async function loadTaskCache(store: KeyValueStore, userId: string): Promise<TaskCache | null> {
  const cache = await readTaskCache(store);
  return cache !== null && cache.ownerId === userId ? cache : null;
}

/**
 * The copy to work with for `userId`. A copy owned by someone else, or any copy once the queue
 * dropped another person's changes (`queueCleared`), is removed from storage here and an empty copy
 * is returned, so the caller cannot show it, or save over it, by forgetting a second step.
 */
export async function openTaskCache(store: KeyValueStore, userId: string, queueCleared: boolean): Promise<TaskCache> {
  const cache = await readTaskCache(store);
  if (cache !== null && cache.ownerId === userId && !queueCleared) return cache;
  if (cache !== null || queueCleared) await clearTaskCache(store);
  return emptyTaskCache(userId);
}

export function saveTaskCache(store: KeyValueStore, cache: TaskCache): Promise<void> {
  return store.setJSON(CACHE_KEY, cache);
}

export function clearTaskCache(store: KeyValueStore): Promise<void> {
  return store.remove(CACHE_KEY);
}

export function setProjectTasks(cache: TaskCache, projectId: string, tasks: Task[]): TaskCache {
  return { ...cache, byProject: { ...cache.byProject, [projectId]: tasks } };
}

export function setProjectLabels(cache: TaskCache, projectId: string, labels: Label[]): TaskCache {
  return { ...cache, labelsByProject: { ...cache.labelsByProject, [projectId]: labels } };
}

export function setProjectFilters(cache: TaskCache, projectId: string, filters: TaskFilters): TaskCache {
  return { ...cache, filters: { ...cache.filters, [projectId]: filters } };
}

export function filtersFor(cache: TaskCache, projectId: string): TaskFilters {
  return cache.filters[projectId] ?? DEFAULT_FILTERS;
}

/** Drops the tasks and filter choices of projects that are no longer in `projectIds`. */
export function pruneTaskCache(cache: TaskCache, projectIds: string[]): TaskCache {
  const keep = new Set(projectIds);
  const only = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => keep.has(id)));
  return {
    ...cache,
    byProject: only(cache.byProject),
    labelsByProject: only(cache.labelsByProject),
    filters: only(cache.filters),
  };
}

const NO_LABELS: Label[] = [];

/** The project's labels in the cache (a stable empty list when it has none). */
export const labelsFor = (cache: TaskCache, projectId: string): Label[] => cache.labelsByProject[projectId] ?? NO_LABELS;

function assigneesFor(ids: string[], names: Record<string, string>, existing: TaskAssignee[]): TaskAssignee[] {
  return ids.map((id) => ({ id, displayName: names[id] ?? existing.find((a) => a.id === id)?.displayName ?? "" }));
}

/** A change's field values laid over a task. */
function withFields(task: Task, data: Record<string, unknown>): Task {
  const next = { ...task };
  if (typeof data.title === "string") next.title = data.title;
  if (typeof data.description === "string") next.description = data.description;
  if ((TASK_STATUSES as readonly unknown[]).includes(data.status)) next.status = data.status as Task["status"];
  if ("due" in data) {
    const due = data.due as { date: string; time: string | null } | null;
    next.dueDate = due ? due.date : null;
    next.dueTime = due ? due.time : null;
  }
  if (Array.isArray(data.labels) && data.labels.every((id) => typeof id === "string")) {
    next.labelIds = [...(data.labels as string[])];
  }
  if (Array.isArray(data.assignees)) {
    const names = isRecord(data.assigneeNames) ? (data.assigneeNames as Record<string, string>) : {};
    next.assignees = assigneesFor(data.assignees as string[], names, task.assignees);
  }
  return next;
}

/** A waiting checklist or item change laid over one task. Anything whose parent is missing is ignored. */
function withChecklistChange(task: Task, change: Change): Task {
  const { data } = change;
  if (change.entity === CHECKLIST_ENTITY) {
    if (change.kind === "delete") return { ...task, checklists: task.checklists.filter((c) => c.id !== change.entityId) };
    if (task.checklists.some((c) => c.id === change.entityId)) {
      if (typeof data.name !== "string") return task;
      const name = data.name;
      return { ...task, checklists: task.checklists.map((c) => (c.id === change.entityId ? { ...c, name } : c)) };
    }
    if (change.kind !== "create") return task;
    const added: Checklist = {
      id: change.entityId,
      name: typeof data.name === "string" ? data.name : "",
      createdAt: change.createdAt,
      items: [],
    };
    return { ...task, checklists: [...task.checklists, added] };
  }
  // A checklist item.
  const checklistId = String(data.checklistId);
  const mapItems = (fn: (items: ChecklistItem[]) => ChecklistItem[]): Task => {
    if (!task.checklists.some((c) => c.id === checklistId)) return task;
    return { ...task, checklists: task.checklists.map((c) => (c.id === checklistId ? { ...c, items: fn(c.items) } : c)) };
  };
  if (change.kind === "delete") return mapItems((items) => items.filter((i) => i.id !== change.entityId));
  return mapItems((items) => {
    if (items.some((i) => i.id === change.entityId)) {
      return items.map((i) => {
        if (i.id !== change.entityId) return i;
        const next = { ...i };
        if (typeof data.text === "string") next.text = data.text;
        if (typeof data.done === "boolean") next.done = data.done;
        return next;
      });
    }
    if (change.kind !== "create") return items;
    return [
      ...items,
      { id: change.entityId, text: typeof data.text === "string" ? data.text : "", done: data.done === true, createdAt: change.createdAt },
    ];
  });
}

/**
 * The server's list for one project with the waiting changes replayed on top (R14), so offline
 * edits never vanish after a refresh. Only changes for this project are applied: task changes, and
 * checklist and item changes on their task, in the order they wait. A waiting edit for a task the
 * server no longer has is ignored. A waiting label delete takes that label off every task. Order:
 * server order, then tasks created offline in the order they were made.
 */
export function applyTaskOverlay(projectId: string, serverList: Task[], waiting: Change[]): Task[] {
  let list: Task[] = serverList.map((t) => ({ ...t }));
  const deletedLabels = new Set<string>();
  for (const change of waiting) {
    if (change.data.projectId !== projectId) continue;
    if (change.entity === LABEL_ENTITY) {
      if (change.kind === "delete") deletedLabels.add(change.entityId);
      continue;
    }
    if (change.entity === CHECKLIST_ENTITY || change.entity === ITEM_ENTITY) {
      const taskId = String(change.data.taskId);
      list = list.map((t) => (t.id === taskId ? withChecklistChange(t, change) : t));
      continue;
    }
    if (change.entity === TASK_LABELS_ENTITY) {
      if (change.kind !== "delete") list = list.map((t) => (t.id === change.entityId ? withFields(t, { labels: change.data.labels }) : t));
      continue;
    }
    if (change.entity !== TASK_ENTITY) continue;
    const index = list.findIndex((t) => t.id === change.entityId);
    if (change.kind === "delete") {
      if (index >= 0) list = list.filter((_, i) => i !== index);
    } else if (index >= 0) {
      list[index] = withFields(list[index], change.data);
    } else if (change.kind === "create") {
      const blank: Task = {
        id: change.entityId,
        projectId,
        title: "",
        description: "",
        status: "todo",
        dueDate: null,
        dueTime: null,
        assignees: [],
        createdById: typeof change.data.createdById === "string" ? change.data.createdById : null,
        createdAt: change.createdAt,
        labelIds: [],
        checklists: [],
      };
      list.push(withFields(blank, change.data));
    }
  }
  if (deletedLabels.size > 0) {
    list = list.map((t) =>
      t.labelIds.some((id) => deletedLabels.has(id)) ? { ...t, labelIds: t.labelIds.filter((id) => !deletedLabels.has(id)) } : t,
    );
  }
  return list;
}

/** The server's labels for one project with the waiting label changes replayed on top. */
export function applyLabelOverlay(projectId: string, serverLabels: Label[], waiting: Change[]): Label[] {
  let list: Label[] = serverLabels.map((l) => ({ ...l }));
  for (const change of waiting) {
    if (change.entity !== LABEL_ENTITY || change.data.projectId !== projectId) continue;
    if (change.kind === "delete") {
      list = list.filter((l) => l.id !== change.entityId);
      continue;
    }
    const index = list.findIndex((l) => l.id === change.entityId);
    if (index < 0 && change.kind !== "create") continue;
    const next: Label = index >= 0 ? { ...list[index] } : { id: change.entityId, projectId, name: "", colour: "gray" };
    if (typeof change.data.name === "string") next.name = change.data.name;
    if (LABEL_COLOURS.includes(change.data.colour)) next.colour = change.data.colour as Label["colour"];
    if (index >= 0) list[index] = next;
    else list.push(next);
  }
  return list;
}
