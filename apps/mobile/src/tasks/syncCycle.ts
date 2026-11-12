/**
 * The sync cycle for tasks, kept free of React so it can be tested. Tasks share the one write queue
 * (the projects provider flushes it), so this does not flush: it supplies the per-entity result
 * `handlers` for `registerTaskEntity`, and fetches a project's tasks again when asked.
 *
 * - handlers.onApplied: the cached task becomes the server's reply (a malformed reply marks the project for refresh).
 * - handlers.onRejected: sets the notice, removes the task on 404, and marks the project for refresh.
 * - refresh(projectId): list, replay the waiting changes on top, commit.
 * - refreshPending(): after a flush, refresh every project marked above.
 */
import { ApiError } from "../lib/api";
import type { Change, Queue } from "../sync/queue";
import * as outcomes from "./outcomes";
import { applyTaskOverlay, isTask } from "./store";
import { taskProjectId } from "./sync";
import type { Task } from "./types";
import type { TaskRejectedNotice } from "./outcomes";

export type RefreshResult = "ok" | "offline" | "gone" | "skipped";

export type TaskSyncCycleDeps = {
  getQueue: () => Queue;
  getToken: () => Promise<string | null>;
  listTasks: (token: string, projectId: string) => Promise<Task[]>;
  getTasks: (projectId: string) => Task[];
  /** Shows and saves one project's list. */
  commit: (projectId: string, list: Task[]) => Promise<unknown>;
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
        const outcome = outcomes.onRejected(deps.getTasks(projectId), change, error, await deps.getQueue().waiting());
        deps.setNotice(outcome.notice);
        marked.add(outcome.refreshProjectId);
        await deps.commit(projectId, outcome.list);
      });
    },
  };

  async function refresh(projectId: string): Promise<RefreshResult> {
    const gen = deps.getGeneration();
    const token = await deps.getToken();
    if (!token || gen !== deps.getGeneration()) return "skipped";
    try {
      const server = (await deps.listTasks(token, projectId)).filter(isTask);
      const waiting = await deps.settleMutations();
      if (gen !== deps.getGeneration()) return "skipped";
      await deps.commit(projectId, applyTaskOverlay(projectId, server, waiting));
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
        return "gone";
      }
      // A network failure and a server failure look the same to the person: keep the cache.
      return "offline";
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
      // A refresh that could not reach the server leaves the project marked, so the next flush retries it.
      // (A "skipped" one belongs to a session that has ended; "gone" has nothing left to fetch.)
      if ((await refresh(projectId)) === "offline") marked.add(projectId);
    }
  }

  return {
    handlers,
    refresh,
    refreshPending,
    pendingRefreshes,
    /** Resolves when every result received so far has been applied. */
    idle: () => applyChain.then(() => undefined),
    /** Forget pending refreshes (the session ended). */
    reset: () => marked.clear(),
  };
}
