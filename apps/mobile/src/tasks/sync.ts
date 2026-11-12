import type { Change, EntityHandlers, Queue } from "../sync/queue";
import {
  createTask,
  deleteTask,
  patchTask,
  type CreateTaskBody,
  type TaskField,
  type TaskFieldPatch,
} from "./api";

export const TASK_ENTITY = "task";

/**
 * What a task change's `data` holds. Every change carries `projectId` (the URL needs it).
 * Create and update use the same keys, so the queue folds an edit into a waiting create:
 * title, description, status, due ({ date, time } or null) and assignees (user ids).
 * `assigneeNames` (id to display name) and `createdById` are for showing the task before the
 * server answers; they are never sent.
 */
const FIELDS: TaskField[] = ["title", "description", "status", "due", "assignees"];

type Deps = {
  createTask: (token: string, projectId: string, body: CreateTaskBody) => Promise<unknown>;
  patchTask: (token: string, projectId: string, taskId: string, fields: TaskFieldPatch) => Promise<unknown>;
  deleteTask: (token: string, projectId: string, taskId: string) => Promise<unknown>;
};

const realDeps: Deps = { createTask, patchTask, deleteTask };

export function taskProjectId(change: Change): string {
  return String(change.data.projectId);
}

function latestTime(change: Change): string {
  let latest = change.createdAt;
  for (const t of Object.values(change.fieldTimes)) {
    if (Date.parse(t) > Date.parse(latest)) latest = t;
  }
  return latest;
}

export function registerTaskEntity(queue: Queue, handlers: EntityHandlers, deps: Deps = realDeps): void {
  queue.registerEntity(
    TASK_ENTITY,
    {
      create: (change, token) => {
        const { data } = change;
        const body: CreateTaskBody = { id: change.entityId, title: data.title as string, editedAt: latestTime(change) };
        if (data.description !== undefined) body.description = data.description as string;
        if (data.status !== undefined) body.status = data.status as CreateTaskBody["status"];
        const due = data.due as { date: string; time: string | null } | null | undefined;
        if (due) {
          body.dueDate = due.date;
          if (due.time) body.dueTime = due.time;
        }
        if (data.assignees !== undefined) body.assigneeIds = data.assignees as string[];
        return deps.createTask(token, taskProjectId(change), body);
      },
      update: (change, token) => {
        const fields: Record<string, { value: unknown; editedAt: string }> = {};
        for (const field of FIELDS) {
          if (field in change.data) {
            fields[field] = { value: change.data[field], editedAt: change.fieldTimes[field] ?? change.createdAt };
          }
        }
        return deps.patchTask(token, taskProjectId(change), change.entityId, fields as TaskFieldPatch);
      },
      delete: (change, token) => deps.deleteTask(token, taskProjectId(change), change.entityId),
    },
    handlers,
  );
}
