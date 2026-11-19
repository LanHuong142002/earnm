/**
 * The sync cycle for ingredients, kept free of React so it can be tested. Ingredients share the one write queue (the
 * projects provider flushes it), so this does not flush: it supplies the result `handlers` for
 * `registerIngredientEntities`, and fetches a project's ingredients again when asked.
 *
 * - handlers.onApplied: the cached ingredient becomes the server's reply (a malformed reply marks the project for refresh).
 * - handlers.onRejected: sets the notice and marks the project for refresh, which brings back the server's version.
 * - refresh(projectId): list the project's ingredients and save them. Waiting changes are not saved in the cache.
 * - refreshPending(): after a flush, refresh every project marked above.
 */
import { ApiError } from "../lib/api";
import type { Change, ChangeKind } from "../sync/queue";
import { reasonFor, type RejectedReason } from "../tasks/outcomes";
import { isIngredient, withIngredient, withoutIngredient } from "./store";
import type { Ingredient } from "./types";

export type IngredientRefreshResult = "ok" | "offline" | "error" | "gone" | "skipped";

export type IngredientRejectedReason = RejectedReason | "nameTaken";

/** A refused ingredient change, for the notice at the top of the screen. */
export type IngredientRejectedNotice = {
  kind: ChangeKind;
  /** The ingredient's name, when the phone knows it. */
  ingredientName: string | null;
  reason: IngredientRejectedReason;
};

/** Why the server refused an ingredient change for good. */
export function ingredientReasonFor(error: ApiError): IngredientRejectedReason {
  if (error.code === "ingredient_name_taken") return "nameTaken";
  if (error.code === "ingredient_limit_reached") return "limit";
  return reasonFor(error);
}

export type IngredientSyncCycleDeps = {
  getToken: () => Promise<string | null>;
  listIngredients: (token: string, projectId: string) => Promise<Ingredient[]>;
  /** The project's cached ingredients (the server's, no waiting changes); null when it was never fetched. */
  getIngredients: (projectId: string) => Ingredient[] | null;
  /** Shows and saves one project's list. Writes are applied in the order given. */
  commit: (projectId: string, list: Ingredient[]) => Promise<unknown>;
  setNotice: (notice: IngredientRejectedNotice) => void;
  /** Changes when the session ends or the person changes; late results are then dropped. */
  getGeneration: () => number;
  /** True after the person's own sign-out: nothing may be written. */
  isWiped: () => boolean;
  onNotSignedIn: () => void;
};

export function createIngredientSyncCycle(deps: IngredientSyncCycleDeps) {
  let applyChain: Promise<unknown> = Promise.resolve();
  const marked = new Set<string>();

  const handlers = {
    onApplied: (change: Change, response: unknown) => {
      applyChain = applyChain.then(async () => {
        if (deps.isWiped()) return;
        const projectId = String(change.data.projectId);
        const list = deps.getIngredients(projectId);
        if (change.kind === "delete") {
          if (list) await deps.commit(projectId, withoutIngredient(list, change.entityId));
          return;
        }
        // A reply for a project that was never fetched would make a one-item list; the refresh brings the rest.
        if (!isIngredient(response) || list === null) {
          marked.add(projectId);
          return;
        }
        await deps.commit(projectId, withIngredient(list, response));
      });
    },
    onRejected: (change: Change, error: ApiError) => {
      applyChain = applyChain.then(() => {
        if (deps.isWiped()) return;
        const projectId = String(change.data.projectId);
        const known = deps.getIngredients(projectId)?.find((i) => i.id === change.entityId)?.name;
        const name = known ?? (typeof change.data.name === "string" ? change.data.name : null);
        deps.setNotice({ kind: change.kind, ingredientName: name, reason: ingredientReasonFor(error) });
        marked.add(projectId);
      });
    },
  };

  async function refresh(projectId: string): Promise<IngredientRefreshResult> {
    const gen = deps.getGeneration();
    const token = await deps.getToken();
    if (!token || gen !== deps.getGeneration()) return "skipped";
    try {
      const server = (await deps.listIngredients(token, projectId)).filter(isIngredient);
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
        // The project is gone or the person left it: its ingredients are no longer theirs to see.
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
