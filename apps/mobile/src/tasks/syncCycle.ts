/**
 * The sync cycle for tasks, kept free of React so it can be tested. Tasks share the one write queue
 * (the projects provider flushes it), so this does not flush: it supplies the per-entity result
 * `handlers` for `registerTaskEntity`, and fetches a project's tasks again when asked.
 *
 * - handlers.onApplied: the cached task becomes the server's reply (a malformed reply marks the project for refresh).
 * - handlers.onRejected: sets the notice, removes the task on 404, and marks the project for refresh.
 * - The same two handlers serve labels, checklists, items, reminders and a task's label set (picked by the change's entity).
 *   A reminder result only marks its project for a refresh (the reminders are cached apart from the tasks).
 * - refresh(projectId): list tasks and labels, replay the waiting changes on top, commit; also fetch the project's reminders.
 * - refreshPending(): after a flush, refresh every project marked above.
 */
import { ApiError } from "../lib/api";
import type { Change, Queue } from "../sync/queue";
import { REMINDER_ENTITY } from "./entities";
import * as outcomes from "./outcomes";
import { parseProjectReminders } from "./reminders/store";
import { reminderRejectedOutcome } from "./reminders/sync";
import type { ProjectReminders } from "./reminders/types";
import { applyLabelOverlay, applyTaskOverlay, isLabel, isTask } from "./store";
import { CHECKLIST_ENTITY, ITEM_ENTITY, LABEL_ENTITY, TASK_LABELS_ENTITY, taskProjectId } from "./sync";
import type { Label, Task } from "./types";
import type { TaskRejectedNotice } from "./outcomes";

export type RefreshResult = "ok" | "offline" | "error" | "gone" | "skipped";

export type TaskSyncCycleDeps = {
  getQueue: () => Queue;
  getToken: () => Promise<string | null>;
  listTasks: (token: string, projectId: string) => Promise<Task[]>;
  getTasks: (projectId: string) => Task[];
  listLabels: (token: string, projectId: string) => Promise<Label[]>;
  getLabels: (projectId: string) => Label[];
  /** Shows and saves one project's list. */
  commit: (projectId: string, list: Task[]) => Promise<unknown>;
  /** Shows and saves one project's labels. */
  commitLabels: (projectId: string, labels: Label[]) => Promise<unknown>;
  /** The project's reminders and the "Nhắc kèm" comments that ride along. Absent: reminders are not fetched. */
  listReminders?: (token: string, projectId: string) => Promise<unknown>;
  /** Saves one project's reminders as the server sent them (null: the project is gone). */
  commitReminders?: (projectId: string, data: ProjectReminders | null) => Promise<unknown>;
  setNotice: (notice: TaskRejectedNotice) => void;
  /** Changes when the session ends or the person changes; late results are then dropped. */
  getGeneration: () => number;
  /** True after the person's own sign-out: nothing may be written. */
  isWiped: () => boolean;
  /** Waits until no local change is being recorded, then returns the changes still waiting. */
  settleMutations: () => Promise<Change[]>;
  onNotSignedIn: () => void;
};

export function createTaskSyncCycle(deps: TaskSyncCycleDeps) {
  let applyChain: Promise<unknown> = Promise.resolve();
  const marked = new Set<string>();

  const handlers = {
    onApplied: (change: Change, response: unknown) => {
      applyChain = applyChain.then(async () => {
        if (deps.isWiped()) return;
        const projectId = taskProjectId(change);
        if (change.entity === LABEL_ENTITY) {
          if (change.kind !== "delete" && !isLabel(response)) {
            marked.add(projectId);
            return;
          }
          const waiting = await deps.getQueue().waiting();
          await deps.commitLabels(projectId, outcomes.onLabelApplied(deps.getLabels(projectId), change, response, waiting));
          return;
        }
        if (change.entity === CHECKLIST_ENTITY || change.entity === ITEM_ENTITY) {
          const wellFormed = typeof response === "object" && response !== null && typeof (response as { id?: unknown }).id === "string";
          if (change.kind !== "delete" && !wellFormed) {
            marked.add(projectId);
            return;
          }
          const waiting = await deps.getQueue().waiting();
          await deps.commit(projectId, outcomes.onChildApplied(deps.getTasks(projectId), change, response, waiting));
          return;
        }
        if (change.entity === REMINDER_ENTITY) {
          // The cached reminders come from the server's list, so fetch it again to show what was saved.
          marked.add(projectId);
          return;
        }
        if (change.entity === TASK_LABELS_ENTITY && change.kind === "delete") return;
        if (change.kind !== "delete" && !isTask(response)) {
          // A malformed reply must not remove the task; the next refresh brings the server's version.
          marked.add(projectId);
          return;
        }
        const waiting = await deps.getQueue().waiting();
        await deps.commit(projectId, outcomes.onApplied(deps.getTasks(projectId), change, response as Task | undefined, waiting));
      });
    },
    onRejected: (change: Change, error: ApiError) => {
      applyChain = applyChain.then(async () => {
        if (deps.isWiped()) return;
        const projectId = taskProjectId(change);
        if (change.entity === LABEL_ENTITY) {
          const queue = deps.getQueue();
          const outcome = outcomes.onLabelRejected(
            deps.getLabels(projectId),
            deps.getTasks(projectId),
            change,
            error,
            await queue.waiting(),
          );
          deps.setNotice(outcome.notice);
          marked.add(outcome.refreshProjectId);
          if (outcome.removedLabelId !== null) {
            // The label will never exist: its other waiting changes go too. Its place on waiting label sets was
            // taken out by the label create's sender before the queue moved on (R15).
            await queue.dropEntity(LABEL_ENTITY, outcome.removedLabelId);
          }
          await deps.commitLabels(projectId, outcome.labels);
          await deps.commit(projectId, outcome.list);
          return;
        }
        if (change.entity === CHECKLIST_ENTITY || change.entity === ITEM_ENTITY) {
          const outcome = outcomes.onChildRejected(deps.getTasks(projectId), change, error, await deps.getQueue().waiting());
          deps.setNotice(outcome.notice);
          marked.add(outcome.refreshProjectId);
          await deps.commit(projectId, outcome.list);
          return;
        }
        if (change.entity === REMINDER_ENTITY) {
          const taskTitle = deps.getTasks(projectId).find((t) => t.id === String(change.data.taskId))?.title ?? null;
          const outcome = reminderRejectedOutcome(change, error, taskTitle);
          deps.setNotice(outcome.notice);
          marked.add(outcome.refreshProjectId);
          return;
        }
        if (change.entity === TASK_LABELS_ENTITY) {
          // Only the label set is refused: the task keeps its other edits. The refresh shows the server's labels.
          const taskTitle = deps.getTasks(projectId).find((t) => t.id === change.entityId)?.title ?? null;
          deps.setNotice({ kind: "update", taskTitle, reason: outcomes.reasonFor(error), subject: "taskLabels" });
          marked.add(projectId);
          return;
        }
        const outcome = outcomes.onRejected(deps.getTasks(projectId), change, error, await deps.getQueue().waiting());
        deps.setNotice(outcome.notice);
        marked.add(outcome.refreshProjectId);
        await deps.commit(projectId, outcome.list);
      });
    },
  };

  /**
   * The project's reminders, or null when they could not be fetched. Reminders are secondary: a failure here (other
   * than being signed out or the project being gone, which the caller handles) leaves the cached copy and the tasks refresh.
   */
  async function fetchReminders(token: string, projectId: string): Promise<ProjectReminders | null> {
    try {
      return parseProjectReminders(await deps.listReminders!(token, projectId));
    } catch (error) {
      if (error instanceof ApiError && (error.code === "not_signed_in" || error.status === 404)) throw error;
      return null;
    }
  }

  async function refresh(projectId: string): Promise<RefreshResult> {
    const gen = deps.getGeneration();
    const token = await deps.getToken();
    if (!token || gen !== deps.getGeneration()) return "skipped";
    try {
      const server = (await deps.listTasks(token, projectId)).filter(isTask);
      const serverLabels = (await deps.listLabels(token, projectId)).filter(isLabel);
      const reminders = deps.listReminders ? await fetchReminders(token, projectId) : null;
      const waiting = await deps.settleMutations();
      if (gen !== deps.getGeneration()) return "skipped";
      await deps.commitLabels(projectId, applyLabelOverlay(projectId, serverLabels, waiting));
      await deps.commit(projectId, applyTaskOverlay(projectId, server, waiting));
      // The overlay of waiting reminder changes is applied where they are shown, so the server's list is kept as it came.
      if (reminders && deps.commitReminders) await deps.commitReminders(projectId, reminders);
      return "ok";
    } catch (error) {
      if (gen !== deps.getGeneration()) return "skipped";
      if (error instanceof ApiError && error.code === "not_signed_in") {
        deps.onNotSignedIn();
        return "skipped";
      }
      if (error instanceof ApiError && error.status === 404) {
        // The project is gone or the person left it: its tasks are no longer theirs to see.
        await deps.commit(projectId, []);
        await deps.commitLabels(projectId, []);
        await deps.commitReminders?.(projectId, null);
        return "gone";
      }
      // Keep the cache either way, but tell the two apart: a server that answered with an error
      // (500 and the like) is not "offline", and the screen must not say it is.
      return error instanceof ApiError && error.code === "network" ? "offline" : "error";
    }
  }

  /** Projects marked for a refresh since the last call; the marks are cleared. */
  function pendingRefreshes(): string[] {
    const ids = [...marked];
    marked.clear();
    return ids;
  }

  async function refreshPending(): Promise<void> {
    await applyChain;
    for (const projectId of pendingRefreshes()) {
      // A refresh that failed leaves the project marked, so the next flush retries it.
      // (A "skipped" one belongs to a session that has ended; "gone" has nothing left to fetch.)
      const result = await refresh(projectId);
      if (result === "offline" || result === "error") marked.add(projectId);
    }
  }

  return {
    handlers,
    refresh,
    refreshPending,
    /** Resolves when every result received so far has been applied. */
    idle: () => applyChain.then(() => undefined),
    /** Forget pending refreshes (the session ended). */
    reset: () => marked.clear(),
  };
}
