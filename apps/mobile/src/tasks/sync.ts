import { ApiError } from "../lib/api";
import type { Change, EntityHandlers, Queue } from "../sync/queue";
import type { LabelColour } from "../theme/tokens";
import {
  createChecklist,
  createChecklistItem,
  createLabel,
  createTask,
  deleteChecklist,
  deleteChecklistItem,
  deleteLabel,
  deleteTask,
  patchChecklist,
  patchChecklistItem,
  patchLabel,
  patchTask,
  type ChecklistItemFieldPatch,
  type CreateTaskBody,
  type LabelFieldPatch,
  type TaskField,
  type TaskFieldPatch,
} from "./api";
import { CHECKLIST_ENTITY, COMMENT_ENTITY, ITEM_ENTITY, LABEL_ENTITY, TASK_ENTITY, TASK_LABELS_ENTITY } from "./entities";
import { stripLabelFromWaiting } from "./waitingLabels";

export { CHECKLIST_ENTITY, COMMENT_ENTITY, ITEM_ENTITY, LABEL_ENTITY, TASK_ENTITY, TASK_LABELS_ENTITY };

/**
 * What a task change's `data` holds. Every change carries `projectId` (the URL needs it).
 * Create and update use the same keys, so the queue folds an edit into a waiting create:
 * title, description, status, due ({ date, time } or null) and assignees (user ids).
 * New changes never carry `labels` (a task's labels are the separate `taskLabels` entity). A change
 * saved by an older app version may still carry them; it is forwarded as before (a create then patches them).
 * `assigneeNames` (id to display name) and `createdById` are for showing the task before the
 * server answers; they are never sent.
 */
const FIELDS: TaskField[] = ["title", "description", "status", "due", "assignees", "labels"];

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

/**
 * Registers tasks, and a task's labels as their own entity: `taskLabels` (`entityId` = task id) holds
 * `projectId` and `labels` (the whole set of label ids), and is only ever an update.
 */
export function registerTaskEntity(queue: Queue, handlers: EntityHandlers, deps: Deps = realDeps): void {
  const sendLabels = (change: Change, token: string) =>
    deps.patchTask(token, taskProjectId(change), change.entityId, {
      labels: { value: (change.data.labels as string[] | undefined) ?? [], editedAt: change.fieldTimes.labels ?? change.createdAt },
    });
  queue.registerEntity(TASK_LABELS_ENTITY, { create: sendLabels, update: sendLabels, delete: () => Promise.resolve(undefined) }, handlers);
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
        const projectId = taskProjectId(change);
        const labels = data.labels as string[] | undefined;
        if (!Array.isArray(labels) || labels.length === 0) return deps.createTask(token, projectId, body);
        // Labels set while the create was still waiting go in a second request: the create has no labels.
        return deps.createTask(token, projectId, body).then(() =>
          deps.patchTask(token, projectId, change.entityId, {
            labels: { value: labels, editedAt: change.fieldTimes.labels ?? change.createdAt },
          }),
        );
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

type ChildDeps = {
  createLabel: typeof createLabel;
  patchLabel: typeof patchLabel;
  deleteLabel: typeof deleteLabel;
  createChecklist: typeof createChecklist;
  patchChecklist: typeof patchChecklist;
  deleteChecklist: typeof deleteChecklist;
  createChecklistItem: typeof createChecklistItem;
  patchChecklistItem: typeof patchChecklistItem;
  deleteChecklistItem: typeof deleteChecklistItem;
};

const realChildDeps: ChildDeps = {
  createLabel,
  patchLabel,
  deleteLabel,
  createChecklist,
  patchChecklist,
  deleteChecklist,
  createChecklistItem,
  patchChecklistItem,
  deleteChecklistItem,
};

/** The queue's own rule for a refusal that no resend will change: a 4xx other than 401, 408 and 429. */
function isPermanentRefusal(error: ApiError): boolean {
  if (error.code === "validation_failed") return true;
  return error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);
}

const timeOf = (change: Change, field: string) => change.fieldTimes[field] ?? change.createdAt;

/**
 * Registers labels, checklists and checklist items with the shared queue. The queue knows none of
 * them: it merges by entity and id, so two ticks of one item are one waiting change, a create followed
 * by an edit is one create, and a create followed by a delete sends nothing.
 *
 * - label: `projectId`, `name`, `colour`.
 * - checklist: `projectId`, `taskId`, `name`.
 * - checklistItem: `projectId`, `taskId`, `checklistId`, `text`, `done`.
 * Each field has its own time, so ticking an item sends only `done`.
 */
export function registerChecklistEntities(queue: Queue, handlers: EntityHandlers, deps: ChildDeps = realChildDeps): void {
  queue.registerEntity(
    LABEL_ENTITY,
    {
      create: async (change, token) => {
        const { data } = change;
        const projectId = taskProjectId(change);
        try {
          return await deps.createLabel(token, projectId, {
            id: change.entityId,
            name: data.name as string,
            colour: data.colour as LabelColour,
            editedAt: latestTime(change),
          });
        } catch (error) {
          // The label will never exist (a taken name, the limit...): take it out of the waiting label sets now,
          // before the queue goes on to send them (R15), then let the queue record the refusal.
          if (error instanceof ApiError && isPermanentRefusal(error)) {
            await stripLabelFromWaiting(queue, projectId, change.entityId, new Date());
          }
          throw error;
        }
      },
      update: (change, token) => {
        const fields: LabelFieldPatch = {};
        if ("name" in change.data) fields.name = { value: change.data.name as string, editedAt: timeOf(change, "name") };
        if ("colour" in change.data) fields.colour = { value: change.data.colour as LabelColour, editedAt: timeOf(change, "colour") };
        return deps.patchLabel(token, taskProjectId(change), change.entityId, fields);
      },
      delete: async (change, token) => {
        // Once the server has deleted the label (or says it is already gone), no waiting label set may name it.
        const projectId = taskProjectId(change);
        let result: unknown;
        try {
          result = await deps.deleteLabel(token, projectId, change.entityId);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            await stripLabelFromWaiting(queue, projectId, change.entityId, new Date());
          }
          throw error;
        }
        await stripLabelFromWaiting(queue, projectId, change.entityId, new Date());
        return result;
      },
    },
    handlers,
  );
  queue.registerEntity(
    CHECKLIST_ENTITY,
    {
      create: (change, token) =>
        deps.createChecklist(token, taskProjectId(change), String(change.data.taskId), {
          id: change.entityId,
          name: change.data.name as string,
          editedAt: latestTime(change),
        }),
      update: (change, token) =>
        deps.patchChecklist(token, taskProjectId(change), String(change.data.taskId), change.entityId, {
          name: { value: change.data.name as string, editedAt: timeOf(change, "name") },
        }),
      delete: (change, token) =>
        deps.deleteChecklist(token, taskProjectId(change), String(change.data.taskId), change.entityId),
    },
    handlers,
  );
  queue.registerEntity(
    ITEM_ENTITY,
    {
      create: async (change, token) => {
        const projectId = taskProjectId(change);
        const taskId = String(change.data.taskId);
        const checklistId = String(change.data.checklistId);
        const created = await deps.createChecklistItem(token, projectId, taskId, checklistId, {
          id: change.entityId,
          text: change.data.text as string,
          editedAt: latestTime(change),
        });
        if (change.data.done !== true) return created;
        // Ticked while the create was still waiting: the create has no `done`, so tick it right after.
        return deps.patchChecklistItem(token, projectId, taskId, checklistId, change.entityId, {
          done: { value: true, editedAt: timeOf(change, "done") },
        });
      },
      update: (change, token) => {
        const fields: ChecklistItemFieldPatch = {};
        if ("text" in change.data) fields.text = { value: change.data.text as string, editedAt: timeOf(change, "text") };
        if ("done" in change.data) fields.done = { value: change.data.done as boolean, editedAt: timeOf(change, "done") };
        return deps.patchChecklistItem(
          token,
          taskProjectId(change),
          String(change.data.taskId),
          String(change.data.checklistId),
          change.entityId,
          fields,
        );
      },
      delete: (change, token) =>
        deps.deleteChecklistItem(
          token,
          taskProjectId(change),
          String(change.data.taskId),
          String(change.data.checklistId),
          change.entityId,
        ),
    },
    handlers,
  );
}
