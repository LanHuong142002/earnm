import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthProvider";
import { getStoredUserId, getToken } from "../auth/token-store";
import { newProjectId as newId } from "../projects/newProjectId";
import { useProjects } from "../projects/ProjectsProvider";
import { asyncStorageStore } from "../sync/asyncStorageStore";
import type { Change, NewChange } from "../sync/queue";
import { listIngredients } from "./api";
import { applyIngredientOverlay, pendingIngredientIds } from "./overlay";
import {
  clearIngredientCache,
  emptyIngredientCache,
  hasIngredients,
  ingredientsOf,
  openIngredientCache,
  pruneIngredientCache,
  saveIngredientCache,
  setProjectIngredients,
  type IngredientCache,
} from "./store";
import { createIngredientSyncCycle, type IngredientRefreshResult, type IngredientRejectedNotice } from "./syncCycle";
import {
  ingredientCreateChange,
  ingredientDeleteChange,
  ingredientUpdateChange,
  registerIngredientEntities,
  type IngredientFieldChanges,
} from "./sync";
import type { Ingredient, IngredientMode, Purchase } from "./types";

export type { IngredientRefreshResult, IngredientRejectedNotice } from "./syncCycle";
export type { IngredientFieldChanges } from "./sync";

export type IngredientInput = { name: string; mode: IngredientMode; purchase: Purchase; isDefault?: boolean };

/** `ok: false` when the provider is not `ready` yet, the ingredient is gone, or a mode change came without its purchase. */
export type IngredientMutationResult<T = object> = ({ ok: true } & T) | { ok: false };

type IngredientsContextValue = {
  /** True once the local copy for the signed-in person is loaded. Mutations and refresh wait for it. */
  ready: boolean;
  /** Whether the project's ingredients are known (cached or fetched). Until then a screen shows its skeleton. */
  loadedFor: (projectId: string) => boolean;
  /** The project's ingredients with the waiting changes laid over them. Not sorted (see `order.ts`). */
  ingredientsFor: (projectId: string) => Ingredient[];
  /** The ingredients of the project with a change waiting ("Chờ lưu"). */
  pendingFor: (projectId: string) => ReadonlySet<string>;
  create: (projectId: string, input: IngredientInput) => Promise<IngredientMutationResult<{ id: string }>>;
  /** Only the given fields change. A mode change must carry the purchase. */
  update: (projectId: string, ingredientId: string, fields: IngredientFieldChanges) => Promise<IngredientMutationResult>;
  remove: (projectId: string, ingredientId: string) => Promise<void>;
  /** Fetches the project's ingredients and saves them. "skipped" until `ready`. */
  refresh: (projectId: string) => Promise<IngredientRefreshResult>;
  rejectedNotice: IngredientRejectedNotice | null;
  dismissRejectedNotice: () => void;
};

const IngredientsContext = createContext<IngredientsContextValue | null>(null);

export function useIngredients(): IngredientsContextValue {
  const value = useContext(IngredientsContext);
  if (!value) throw new Error("useIngredients must be used inside IngredientsProvider");
  return value;
}

export function IngredientsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { registerSignOutCleanup, handleNotSignedIn } = auth;
  const signedIn = auth.status === "signedIn";
  const userId = auth.user?.id ?? null;
  const { sync, projects, status: projectsStatus } = useProjects();
  const { queue, afterEnqueue, onFlushed, runExclusive } = sync;

  const [cache, setCache] = useState<IngredientCache>(() => emptyIngredientCache(""));
  const [waiting, setWaiting] = useState<Change[]>([]);
  const [ready, setReady] = useState(false);
  const [rejectedNotice, setRejectedNotice] = useState<IngredientRejectedNotice | null>(null);

  const cacheRef = useRef<IngredientCache>(cache);
  const readyRef = useRef(false);
  /** Whose copy `cacheRef` is; null until the owner check has run. */
  const loadedOwnerRef = useRef<string | null>(null);
  const genRef = useRef(0);
  /** True from the user's own sign-out until the next sign-in loads; late results must not write storage. */
  const wipedRef = useRef(false);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const notSignedInRef = useRef<() => void>(() => {});

  useEffect(() => {
    notSignedInRef.current = () => void handleNotSignedIn();
  }, [handleNotSignedIn]);

  /** Shows and saves `next`. Saves are written one after another so an older copy never lands last. */
  const publish = useCallback((next: IngredientCache): Promise<unknown> => {
    cacheRef.current = next;
    setCache(next);
    if (wipedRef.current || loadedOwnerRef.current === null) return Promise.resolve();
    const write = saveChain.current
      .catch(() => {})
      .then(() => (wipedRef.current ? undefined : saveIngredientCache(asyncStorageStore, cacheRef.current)))
      .catch(() => {
        // Storage failure: the screen still shows the in-memory list.
      });
    saveChain.current = write;
    return write;
  }, []);

  const commit = useCallback(
    (projectId: string, list: Ingredient[]) => publish(setProjectIngredients(cacheRef.current, projectId, list)),
    [publish],
  );

  const syncWaiting = useCallback(async () => {
    try {
      setWaiting(await queue.waiting());
    } catch {
      // Unreadable queue: keep showing what is there.
    }
  }, [queue]);

  // The cycle only reads the refs when a result arrives or a refresh runs, never while rendering.
  // eslint-disable-next-line react-hooks/refs -- the closures below are called later, not during render
  const [cycle] = useState(() => {
    const c = createIngredientSyncCycle({
      getToken,
      listIngredients,
      getIngredients: (projectId) => cacheRef.current.byProject[projectId] ?? null,
      commit,
      setNotice: setRejectedNotice,
      getGeneration: () => genRef.current,
      isWiped: () => wipedRef.current,
      onNotSignedIn: () => notSignedInRef.current(),
    });
    registerIngredientEntities(queue, c.handlers);
    return c;
  });

  const resetMemory = useCallback(() => {
    genRef.current += 1;
    const empty = emptyIngredientCache("");
    cacheRef.current = empty;
    loadedOwnerRef.current = null;
    readyRef.current = false;
    cycle.reset();
    setCache(empty);
    setWaiting([]);
    setRejectedNotice(null);
    setReady(false);
  }, [cycle]);

  // Load the local copy once the person is known (the stored id when the profile is still offline). The copy of
  // another person is removed by openIngredientCache.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    wipedRef.current = false;
    void (async () => {
      let owner = userId;
      if (!owner) {
        try {
          owner = await getStoredUserId();
        } catch {
          // Unreadable: no saved ingredients are shown until the profile is known.
        }
      }
      if (cancelled || !owner) return;
      let opened: IngredientCache;
      try {
        opened = await openIngredientCache(asyncStorageStore, owner);
      } catch {
        opened = emptyIngredientCache(owner);
      }
      if (cancelled || wipedRef.current) return;
      cacheRef.current = opened;
      loadedOwnerRef.current = owner;
      setCache(opened);
      await syncWaiting();
      if (cancelled) return;
      readyRef.current = true;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      // The session ended: drop in-memory state only. The user's own sign-out wipes the saved copy below.
      resetMemory();
    };
  }, [signedIn, userId, resetMemory, syncWaiting]);

  // After each flush, fetch again the projects whose changes were refused, and show what is still waiting. Runs
  // behind the flush in the shared exclusive lane so a refresh never reads between a send and its result.
  useEffect(() => {
    return onFlushed(() => {
      void syncWaiting();
      if (!readyRef.current) return;
      void runExclusive(async () => {
        await cycle.refreshPending();
      })
        .catch(() => {})
        .finally(() => void syncWaiting());
    });
  }, [onFlushed, runExclusive, cycle, syncWaiting]);

  // The user's sign-out: every local ingredient copy goes.
  useEffect(() => {
    return registerSignOutCleanup(async () => {
      wipedRef.current = true;
      genRef.current += 1;
      try {
        await clearIngredientCache(asyncStorageStore);
      } catch {
        // Best effort.
      }
      resetMemory();
    });
  }, [registerSignOutCleanup, resetMemory]);

  // Forget the ingredients of projects that are no longer in the project list. Only once the project list itself
  // has been confirmed by the server, so a cached or empty list never prunes anything.
  useEffect(() => {
    if (!ready || projectsStatus !== "ready") return;
    const pruned = pruneIngredientCache(cacheRef.current, projects.map((p) => p.id));
    if (Object.keys(pruned.byProject).length !== Object.keys(cacheRef.current.byProject).length) void publish(pruned);
  }, [ready, projectsStatus, projects, publish]);

  /** The project's ingredients as shown: the server's with the waiting changes laid over. */
  const shown = useCallback(
    (projectId: string) => applyIngredientOverlay(projectId, ingredientsOf(cacheRef.current, projectId), waiting),
    [waiting],
  );

  const ingredientsFor = useCallback<IngredientsContextValue["ingredientsFor"]>(
    (projectId) => applyIngredientOverlay(projectId, ingredientsOf(cache, projectId), waiting),
    [cache, waiting],
  );
  const pendingFor = useCallback<IngredientsContextValue["pendingFor"]>((projectId) => pendingIngredientIds(projectId, waiting), [waiting]);
  const loadedFor = useCallback<IngredientsContextValue["loadedFor"]>((projectId) => hasIngredients(cache, projectId), [cache]);

  const enqueueAll = useCallback(
    async (changes: NewChange[]) => {
      for (const change of changes) await queue.enqueue(change);
      await syncWaiting();
      await afterEnqueue();
    },
    [queue, syncWaiting, afterEnqueue],
  );

  const create = useCallback<IngredientsContextValue["create"]>(
    async (projectId, input) => {
      if (!readyRef.current || !loadedOwnerRef.current) return { ok: false };
      const id = newId();
      await enqueueAll([
        ingredientCreateChange({
          id,
          projectId,
          name: input.name.trim(),
          mode: input.mode,
          purchase: input.purchase,
          isDefault: input.isDefault,
          now: new Date(),
        }),
      ]);
      return { ok: true, id };
    },
    [enqueueAll],
  );

  const update = useCallback<IngredientsContextValue["update"]>(
    async (projectId, ingredientId, fields) => {
      if (!readyRef.current || !loadedOwnerRef.current) return { ok: false };
      const current = shown(projectId).find((i) => i.id === ingredientId);
      if (!current) return { ok: false };
      // Only what really changed is queued, so an unchanged field never gets a newer time than another phone's edit.
      const changed: IngredientFieldChanges = {};
      if (fields.name !== undefined && fields.name.trim() !== current.name) changed.name = fields.name.trim();
      if (fields.isDefault !== undefined && fields.isDefault !== current.isDefault) changed.isDefault = fields.isDefault;
      const p = fields.purchase;
      const purchaseChanged =
        p !== undefined && (p.quantity !== current.purchase.quantity || p.unit !== current.purchase.unit || p.price !== current.purchase.price);
      if (purchaseChanged) changed.purchase = p;
      if (fields.mode !== undefined && fields.mode !== current.mode) {
        // The unit has to fit the mode, so the new purchase always travels with it.
        if (p === undefined) return { ok: false };
        changed.mode = fields.mode;
        changed.purchase = p;
      }
      if (Object.keys(changed).length > 0) {
        await enqueueAll([ingredientUpdateChange({ id: ingredientId, projectId, fields: changed, now: new Date() })]);
      }
      return { ok: true };
    },
    [shown, enqueueAll],
  );

  const remove = useCallback<IngredientsContextValue["remove"]>(
    async (projectId, ingredientId) => {
      if (!readyRef.current) return;
      if (!shown(projectId).some((i) => i.id === ingredientId)) return;
      await enqueueAll([ingredientDeleteChange({ id: ingredientId, projectId })]);
    },
    [shown, enqueueAll],
  );

  const refresh = useCallback<IngredientsContextValue["refresh"]>(
    async (projectId) => {
      if (!readyRef.current) return "skipped";
      return runExclusive(async () => {
        await cycle.idle();
        return cycle.refresh(projectId);
      });
    },
    [runExclusive, cycle],
  );

  const dismissRejectedNotice = useCallback(() => setRejectedNotice(null), []);

  const value = useMemo<IngredientsContextValue>(
    () => ({ ready, loadedFor, ingredientsFor, pendingFor, create, update, remove, refresh, rejectedNotice, dismissRejectedNotice }),
    [ready, loadedFor, ingredientsFor, pendingFor, create, update, remove, refresh, rejectedNotice, dismissRejectedNotice],
  );

  return <IngredientsContext.Provider value={value}>{children}</IngredientsContext.Provider>;
}
