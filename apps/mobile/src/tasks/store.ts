import type { Change } from "../sync/queue";
import type { KeyValueStore } from "../sync/storage";
import { TASK_ENTITY } from "./sync";
import { DEFAULT_FILTERS, type TaskFilters } from "./filters";
import { TASK_STATUSES, type Task, type TaskAssignee } from "./types";

const CACHE_KEY = "tasks.cache.v1";

export type TaskCache = {
  ownerId: string;
  byProject: Record<string, Task[]>;
  filters: Record<string, TaskFilters>;
  /** Each project's people for the assignee picker, kept for offline use (R27). */
  membersByProject: Record<string, TaskAssignee[]>;
};

export function emptyTaskCache(ownerId: string): TaskCache {
  return { ownerId, byProject: {}, filters: {}, membersByProject: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    typeof value.createdAt === "string"
  );
}

function isAssignee(value: unknown): value is TaskAssignee {
  return isRecord(value) && typeof value.id === "string" && typeof value.displayName === "string";
}

/** Copies saved before members were kept have none; a damaged list is dropped, not the whole copy. */
function readMembers(value: unknown): Record<string, TaskAssignee[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, list]) => Array.isArray(list) && list.every(isAssignee)),
  ) as Record<string, TaskAssignee[]>;
}

function isFilters(value: unknown): value is TaskFilters {
  return (
    isRecord(value) &&
    (value.status === "all" || (TASK_STATUSES as readonly unknown[]).includes(value.status)) &&
    typeof value.mine === "boolean" &&
    // Copies saved before "only me" existed have no onlyMe; they load with it off.
    (value.onlyMe === undefined || typeof value.onlyMe === "boolean") &&
    typeof value.dueSoon === "boolean"
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
  return { ownerId: saved.ownerId, byProject: saved.byProject as Record<string, Task[]>, filters: withDefaults(saved.filters as Record<string, Partial<TaskFilters>>),
    membersByProject: readMembers(saved.membersByProject),
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

export function setProjectMembers(cache: TaskCache, projectId: string, people: TaskAssignee[]): TaskCache {
  return { ...cache, membersByProject: { ...cache.membersByProject, [projectId]: people } };
}

export function setProjectFilters(cache: TaskCache, projectId: string, filters: TaskFilters): TaskCache {
  return { ...cache, filters: { ...cache.filters, [projectId]: filters } };
}

export function filtersFor(cache: TaskCache, projectId: string): TaskFilters {
  return cache.filters[projectId] ?? DEFAULT_FILTERS;
}

/** Drops the tasks, members and filter choices of projects that are no longer in `projectIds`. */
export function pruneTaskCache(cache: TaskCache, projectIds: string[]): TaskCache {
  const keep = new Set(projectIds);
  const only = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => keep.has(id)));
  return {
    ...cache,
    byProject: only(cache.byProject),
    filters: only(cache.filters),
    membersByProject: only(cache.membersByProject),
  };
}

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
  if (Array.isArray(data.assignees)) {
    const names = isRecord(data.assigneeNames) ? (data.assigneeNames as Record<string, string>) : {};
    next.assignees = assigneesFor(data.assignees as string[], names, task.assignees);
  }
  return next;
}

/**
 * The server's list for one project with the waiting changes replayed on top (R14), so offline
 * edits never vanish after a refresh. Only task changes for this project are applied. A waiting
 * edit for a task the server no longer has is ignored. Order: server order, then tasks created
 * offline in the order they were made.
 */
export function applyTaskOverlay(projectId: string, serverList: Task[], waiting: Change[]): Task[] {
  let list: Task[] = serverList.map((t) => ({ ...t }));
  for (const change of waiting) {
    if (change.entity !== TASK_ENTITY || change.data.projectId !== projectId) continue;
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
      };
      list.push(withFields(blank, change.data));
    }
  }
  return list;
}
