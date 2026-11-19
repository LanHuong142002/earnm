/**
 * The sync cycle for ideas, kept free of React so it can be tested. Ideas share the one write queue (the projects
 * provider flushes it), so this does not flush: it supplies the per-entity result `handlers` for
 * `registerIdeaEntities`, and fetches a project's ideas again when asked.
 *
 * - handlers.onApplied: the cached idea becomes the server's reply (a malformed reply marks the project for refresh).
 * - handlers.onRejected: sets the notice and marks the project for refresh, which brings back the server's version.
 * - The same two handlers serve ideas, an idea's label set and an idea's vote (picked by the change's entity).
 * - refresh(projectId): list the project's ideas and save them. Waiting changes are not saved in the cache; the
 *   screen lays them over it.
 * - refreshPending(): after a flush, refresh every project marked above.
 */
import { ApiError } from "../lib/api";
import type { Change, ChangeKind } from "../sync/queue";
import { reasonFor, type RejectedReason } from "../tasks/outcomes";
import { isIdea, withIdea, withoutIdea } from "./store";
import type { Idea } from "./types";

export type IdeaRefreshResult = "ok" | "offline" | "error" | "gone" | "skipped";

/** A refused idea change, for the notice at the top of the screen (same wording rules as the task notice). */
export type IdeaRejectedNotice = {
  kind: ChangeKind;
  /** The idea's title, when the phone knows it. */
  ideaTitle: string | null;
  reason: RejectedReason;
};

/** Why the server refused an idea change for good. The idea limit reads as a limit, like the task limit. */
export function ideaReasonFor(error: ApiError): RejectedReason {
  return error.code === "idea_limit_reached" ? "limit" : reasonFor(error);
}

export type IdeaSyncCycleDeps = {
  getToken: () => Promise<string | null>;
  listIdeas: (token: string, projectId: string) => Promise<Idea[]>;
  /** The project's cached ideas (the server's, no waiting changes); null when it was never fetched. */
  getIdeas: (projectId: string) => Idea[] | null;
  /** Shows and saves one project's list. Writes are applied in the order given. */
  commit: (projectId: string, list: Idea[]) => Promise<unknown>;
  setNotice: (notice: IdeaRejectedNotice) => void;
  /** Changes when the session ends or the person changes; late results are then dropped. */
  getGeneration: () => number;
  /** True after the person's own sign-out: nothing may be written. */
  isWiped: () => boolean;
  onNotSignedIn: () => void;
};

export function createIdeaSyncCycle(deps: IdeaSyncCycleDeps) {
  let applyChain: Promise<unknown> = Promise.resolve();
  const marked = new Set<string>();

  const handlers = {
    onApplied: (change: Change, response: unknown) => {
      applyChain = applyChain.then(async () => {
        if (deps.isWiped()) return;
        const projectId = String(change.data.projectId);
        const list = deps.getIdeas(projectId);
        if (change.kind === "delete") {
          if (list) await deps.commit(projectId, withoutIdea(list, change.entityId));
          return;
        }
        // A reply for a project that was never fetched would make a one-idea list; the refresh brings the rest.
        if (!isIdea(response) || list === null) {
          marked.add(projectId);
          return;
        }
        await deps.commit(projectId, withIdea(list, response));
      });
    },
    onRejected: (change: Change, error: ApiError) => {
      applyChain = applyChain.then(() => {
        if (deps.isWiped()) return;
        const projectId = String(change.data.projectId);
        const known = deps.getIdeas(projectId)?.find((i) => i.id === change.entityId)?.title;
        const title = known ?? (typeof change.data.title === "string" ? change.data.title : null);
        deps.setNotice({ kind: change.kind, ideaTitle: title, reason: ideaReasonFor(error) });
        marked.add(projectId);
      });
    },
  };

  async function refresh(projectId: string): Promise<IdeaRefreshResult> {
    const gen = deps.getGeneration();
    const token = await deps.getToken();
    if (!token || gen !== deps.getGeneration()) return "skipped";
    try {
      const server = (await deps.listIdeas(token, projectId)).filter(isIdea);
      if (gen !== deps.getGeneration()) return "skipped";
      await deps.commit(projectId, server);
      return "ok";
    } catch (error) {
      if (gen !== deps.getGeneration()) return "skipped";
      if (error instanceof ApiError && error.code === "not_signed_in") {
        deps.onNotSignedIn();
        return "skipped";
      }
      if (error instanceof ApiError && error.status === 404) {
        // The project is gone or the person left it: its ideas are no longer theirs to see.
        await deps.commit(projectId, []);
        return "gone";
      }
      // The cache stays either way; a server that answered with an error is not "offline".
      return error instanceof ApiError && error.code === "network" ? "offline" : "error";
    }
  }

  async function refreshPending(): Promise<void> {
    await applyChain;
    const ids = [...marked];
    marked.clear();
    for (const projectId of ids) {
      // A refresh that failed leaves the project marked, so the next flush retries it.
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
