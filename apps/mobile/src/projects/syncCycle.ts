/**
 * The sync cycle for projects, kept free of React so it can be tested: send the waiting changes,
 * apply what the server answered, and (when a change was refused) fetch the server's projects and
 * replay the changes still waiting on top. Everything it touches is injected.
 *
 * - `handlers` go to createQueue (onApplied / onRejected / onSignedOut).
 * - flush(userId): send the queue for that owner; if the server refused something, refresh after.
 * - refresh(): fetch the server's list, drop waiting changes for projects it no longer lists, and show it with the waiting changes replayed.
 * - sync(userId): flush, then refresh.
 */
import { ApiError } from "../lib/api";
import type { Change, Queue } from "../sync/queue";
import type { Project } from "./api";
import * as outcomes from "./outcomes";
import { isProject } from "./store";
import { PROJECT_ENTITY } from "./sync";
import type { RejectedNotice } from "./outcomes";

export type SyncStatus = "loading" | "ready" | "offline";

export type SyncCycleDeps = {
  getQueue: () => Queue;
  getToken: () => Promise<string | null>;
  listProjects: (token: string) => Promise<Project[]>;
  getProjects: () => Project[];
  /** Shows and saves the list. */
  commit: (list: Project[]) => Promise<unknown>;
  setNotice: (notice: RejectedNotice) => void;
  setWaitingCount: (count: number) => void;
  setStatus: (next: SyncStatus | ((current: SyncStatus) => SyncStatus)) => void;
  /** Changes when the session ends or the person changes; late results are then dropped. */
  getGeneration: () => number;
  /** True after the person's own sign-out: nothing may be written. */
  isWiped: () => boolean;
  /** Waits until no local change is being recorded, then returns the changes still waiting. */
  settleMutations: () => Promise<Change[]>;
  onNotSignedIn: () => void;
};

export function createSyncCycle(deps: SyncCycleDeps) {
  let applyChain: Promise<unknown> = Promise.resolve();
  let needsRefresh = false;

  const handlers = {
    onApplied: (change: Change, response: unknown) => {
      applyChain = applyChain.then(async () => {
        if (deps.isWiped()) return;
        const queue = deps.getQueue();
        if (change.kind !== "delete" && !isProject(response)) {
          // A malformed reply must not remove the project; the next refresh brings the server's version.
          needsRefresh = true;
          deps.setWaitingCount(await queue.count());
          return;
        }
        const next = outcomes.onApplied(deps.getProjects(), change, response as Project | undefined, await queue.waiting());
        await deps.commit(next);
        deps.setWaitingCount(await queue.count());
      });
    },
    onRejected: (change: Change, error: ApiError) => {
      applyChain = applyChain.then(async () => {
        if (deps.isWiped()) return;
        const queue = deps.getQueue();
        const outcome = outcomes.onRejected(deps.getProjects(), change, error, await queue.waiting());
        deps.setNotice(outcome.notice);
        if (outcome.needsRefresh) needsRefresh = true; // restores the server's version
        await deps.commit(outcome.list);
        deps.setWaitingCount(await queue.count());
      });
    },
    onSignedOut: () => deps.onNotSignedIn(),
  };

  async function refresh(): Promise<void> {
    const gen = deps.getGeneration();
    const token = await deps.getToken();
    if (!token || gen !== deps.getGeneration()) return;
    try {
      const server = (await deps.listProjects(token)).filter(isProject);
      // Projects the server no longer lists: their waiting changes can never succeed (R26).
      const queue = deps.getQueue();
      for (const id of outcomes.projectsToDrop(server, await queue.waiting())) {
        await queue.dropEntity(PROJECT_ENTITY, id);
      }
      const waiting = await deps.settleMutations();
      if (gen !== deps.getGeneration()) return;
      await deps.commit(outcomes.restoreFromServer(server, waiting));
      deps.setWaitingCount(waiting.length);
      deps.setStatus("ready");
    } catch (error) {
      if (gen !== deps.getGeneration()) return;
      if (error instanceof ApiError && error.code === "not_signed_in") deps.onNotSignedIn();
      // A network failure and a server failure (500/502/503) look the same to the person: keep the
      // cache and try again at the next trigger. Never "ready" with nothing, or a phone without a
      // cache would offer "Create your first project" to someone who has projects.
      else deps.setStatus("offline");
    }
  }

  /** `requestedGen` is the generation when the sync was asked for; a session change since then cancels it. */
  async function flush(userId: string | null, requestedGen: number = deps.getGeneration()): Promise<void> {
    const gen = deps.getGeneration();
    if (requestedGen !== gen) return;
    needsRefresh = false;
    if (!userId) return; // cannot tell whose changes are waiting: send nothing
    const queue = deps.getQueue();
    await queue.flush(userId);
    await applyChain;
    if (gen !== deps.getGeneration()) return;
    deps.setWaitingCount(await queue.count());
    if (needsRefresh) {
      needsRefresh = false;
      await refresh();
    }
  }

  async function sync(userId: string | null, requestedGen: number = deps.getGeneration()): Promise<void> {
    await flush(userId, requestedGen);
    await refresh();
  }

  return {
    handlers,
    flush,
    refresh,
    sync,
    /** Forget a pending refresh (the session ended). */
    reset: () => {
      needsRefresh = false;
    },
  };
}
