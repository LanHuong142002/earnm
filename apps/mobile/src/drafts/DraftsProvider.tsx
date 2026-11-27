import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthProvider";
import { getStoredUserId, getToken } from "../auth/token-store";
import { useIngredients } from "../ingredients/IngredientsProvider";
import type { IngredientMode } from "../ingredients/types";
import { newProjectId as newId } from "../projects/newProjectId";
import { useProjects } from "../projects/ProjectsProvider";
import { useProducts } from "../products/ProductsProvider";
import { SIZE_NAMES, type SizeName } from "../products/types";
import { asyncStorageStore } from "../sync/asyncStorageStore";
import type { Change, NewChange } from "../sync/queue";
import { photoDeps } from "../tasks/photos/realDeps";
import { clearPhotoCache, prunePhotoCache, updatePhotoCache } from "../tasks/photos/store";
import { registerPhotoEntities } from "../tasks/photos/uploads";
import { DRAFT_PHOTOS } from "./adapters";
import { convertDraft as apiConvertDraft, draftPhotosApi, listDrafts } from "./api";
import { recoveredConvert, runConvert, shouldRefreshAfter, type ConvertResult } from "./convert";
import { DRAFT_LINE_ENTITY, DRAFT_STATUS_ENTITY } from "./entities";
import { applyDraftOverlay, pendingDraftIds } from "./overlay";
import {
  clearDraftCache,
  draftsOf,
  withDraft,
  emptyDraftCache,
  hasDrafts,
  openDraftCache,
  pruneDraftCache,
  saveDraftCache,
  setProjectDrafts,
  convertedTotalOf,
  type DraftCache,
} from "./store";
import {
  draftCreateChange,
  draftDeleteChange,
  draftLineCreateChange,
  draftLineDeleteChange,
  draftLineUpdateChange,
  draftStatusChange,
  draftUpdateChange,
  registerDraftEntities,
  type DraftFieldChanges,
  type DraftLineFieldChanges,
} from "./sync";
import { createDraftSyncCycle, type DraftRefreshResult, type DraftRejectedNotice } from "./syncCycle";
import type { Draft, DraftStatus } from "./types";

export type { DraftRefreshResult, DraftRejectedNotice } from "./syncCycle";
export type { ConvertResult } from "./convert";
export type { DraftFieldChanges, DraftLineFieldChanges } from "./sync";

/** `ok: false` when the provider is not `ready` yet, the draft is gone or read-only, or the input is not valid. */
export type DraftMutationResult<T = object> = ({ ok: true } & T) | { ok: false };

export type DraftInput = { name: string; sizes: SizeName[]; expectedPrice?: number | null; note?: string };

/** A line to add; the provider gives it its id. */
export type DraftLineInput =
  | { kind: "existing"; ingredientId: string; amount: number }
  | { kind: "new"; newName: string; newKind: IngredientMode; purchaseQty?: number | null; purchasePrice?: number | null; amount: number };

type DraftsContextValue = {
  /** True once the local copy for the signed-in person is loaded. Mutations and refresh wait for it. */
  ready: boolean;
  /** Whether the project's drafts are known (cached or fetched). Until then a screen shows its skeleton. */
  loadedFor: (projectId: string) => boolean;
  /** The project's drafts with the waiting changes laid over them. Not sorted. */
  draftsFor: (projectId: string) => Draft[];
  /** How many converted drafts the server has (the list holds only the newest 50); null until known. */
  convertedTotalFor: (projectId: string) => number | null;
  /** The drafts of the project with a change waiting ("Chờ lưu"). */
  draftPendingFor: (projectId: string) => ReadonlySet<string>;
  createDraft: (projectId: string, input: DraftInput) => Promise<DraftMutationResult<{ id: string }>>;
  /**
   * Puts a draft the server has already made (from an idea) into the list and the saved copy, with nothing queued.
   * Left alone when the project's list is not known yet: the next refresh brings it.
   */
  addServerDraft: (projectId: string, draft: Draft) => Promise<void>;
  /** Only the fields that really changed are queued. */
  editDraft: (projectId: string, draftId: string, fields: DraftFieldChanges) => Promise<DraftMutationResult>;
  /** A server `draft_incomplete` comes back through `rejectedNotice` (with its `missing` list). */
  setDraftStatus: (projectId: string, draftId: string, status: DraftStatus) => Promise<DraftMutationResult>;
  deleteDraft: (projectId: string, draftId: string) => Promise<void>;
  addLine: (projectId: string, draftId: string, line: DraftLineInput) => Promise<DraftMutationResult<{ id: string }>>;
  editLine: (projectId: string, draftId: string, lineId: string, fields: DraftLineFieldChanges) => Promise<DraftMutationResult>;
  removeLine: (projectId: string, draftId: string, lineId: string) => Promise<void>;
  /**
   * Needs the network; never queued. Sends the draft's waiting changes first, then converts, and on success refreshes
   * drafts, products and ingredients. `{ok:false, code:"offline"}` without a network.
   */
  convertDraft: (projectId: string, draftId: string) => Promise<ConvertResult>;
  /** Fetches the project's drafts and saves them. "skipped" until `ready`. */
  refresh: (projectId: string) => Promise<DraftRefreshResult>;
  rejectedNotice: DraftRejectedNotice | null;
  dismissRejectedNotice: () => void;
};

const DraftsContext = createContext<DraftsContextValue | null>(null);

export function useDrafts(): DraftsContextValue {
  const value = useContext(DraftsContext);
  if (!value) throw new Error("useDrafts must be used inside DraftsProvider");
  return value;
}

const NAME_MAX = 60;
const NOTE_MAX = 500;
const sortedSizes = (sizes: readonly SizeName[]) => SIZE_NAMES.filter((s) => sizes.includes(s));
const validPrice = (v: number | null | undefined) => v === null || v === undefined || (Number.isInteger(v) && v >= 0);
const validQty = (v: number | null | undefined) => v === null || v === undefined || (typeof v === "number" && v > 0);

export function DraftsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { registerSignOutCleanup, handleNotSignedIn } = auth;
  const signedIn = auth.status === "signedIn";
  const userId = auth.user?.id ?? null;
  const { sync, projects, status: projectsStatus } = useProjects();
  const { queue, afterEnqueue, onFlushed, runExclusive } = sync;
  const { refresh: refreshProducts } = useProducts();
  const { refresh: refreshIngredients } = useIngredients();

  const [cache, setCache] = useState<DraftCache>(() => emptyDraftCache(""));
  const [waiting, setWaiting] = useState<Change[]>([]);
  const [ready, setReady] = useState(false);
  const [rejectedNotice, setRejectedNotice] = useState<DraftRejectedNotice | null>(null);

  const cacheRef = useRef<DraftCache>(cache);
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
  const publish = useCallback((next: DraftCache): Promise<unknown> => {
    cacheRef.current = next;
    setCache(next);
    if (wipedRef.current || loadedOwnerRef.current === null) return Promise.resolve();
    const write = saveChain.current
      .catch(() => {})
      .then(() => (wipedRef.current ? undefined : saveDraftCache(asyncStorageStore, cacheRef.current)))
      .catch(() => {
        // Storage failure: the screen still shows the in-memory list.
      });
    saveChain.current = write;
    return write;
  }, []);

  const commit = useCallback(
    (projectId: string, list: Draft[], convertedTotal?: number) => publish(setProjectDrafts(cacheRef.current, projectId, list, convertedTotal)),
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
    const c = createDraftSyncCycle({
      getToken,
      listDrafts,
      getEntry: (projectId) => cacheRef.current.byProject[projectId] ?? null,
      commit,
      setNotice: setRejectedNotice,
      getGeneration: () => genRef.current,
      isWiped: () => wipedRef.current,
      onNotSignedIn: () => notSignedInRef.current(),
    });
    registerDraftEntities(queue, c.handlers);
    // Draft photos keep their own refusals (retry or discard each), not the notice, like an idea's.
    registerPhotoEntities(queue, asyncStorageStore, { ...photoDeps, ...draftPhotosApi }, DRAFT_PHOTOS);
    return c;
  });

  const resetMemory = useCallback(() => {
    genRef.current += 1;
    const empty = emptyDraftCache("");
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
  // another person is removed by openDraftCache.
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
          // Unreadable: no saved drafts are shown until the profile is known.
        }
      }
      if (cancelled || !owner) return;
      let opened: DraftCache;
      try {
        opened = await openDraftCache(asyncStorageStore, owner);
      } catch {
        opened = emptyDraftCache(owner);
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

  // The user's sign-out: every local draft copy goes.
  useEffect(() => {
    return registerSignOutCleanup(async () => {
      wipedRef.current = true;
      genRef.current += 1;
      try {
        await clearDraftCache(asyncStorageStore);
        await clearPhotoCache(asyncStorageStore, DRAFT_PHOTOS);
      } catch {
        // Best effort.
      }
      resetMemory();
    });
  }, [registerSignOutCleanup, resetMemory]);

  // Forget the drafts of projects that are no longer in the project list, once the server confirmed that list.
  useEffect(() => {
    if (!ready || projectsStatus !== "ready") return;
    const ids = projects.map((p) => p.id);
    const pruned = pruneDraftCache(cacheRef.current, ids);
    if (Object.keys(pruned.byProject).length !== Object.keys(cacheRef.current.byProject).length) void publish(pruned);
    const owner = loadedOwnerRef.current;
    if (owner) void updatePhotoCache(asyncStorageStore, owner, (c) => prunePhotoCache(c, ids), DRAFT_PHOTOS).catch(() => {});
  }, [ready, projectsStatus, projects, publish]);

  const draftsShown = useCallback(
    (projectId: string) => applyDraftOverlay(projectId, draftsOf(cacheRef.current, projectId), waiting),
    [waiting],
  );

  const draftsFor = useCallback<DraftsContextValue["draftsFor"]>(
    (projectId) => applyDraftOverlay(projectId, draftsOf(cache, projectId), waiting),
    [cache, waiting],
  );
  const convertedTotalFor = useCallback<DraftsContextValue["convertedTotalFor"]>((projectId) => convertedTotalOf(cache, projectId), [cache]);
  const draftPendingFor = useCallback<DraftsContextValue["draftPendingFor"]>((projectId) => pendingDraftIds(projectId, waiting), [waiting]);
  const loadedFor = useCallback<DraftsContextValue["loadedFor"]>((projectId) => hasDrafts(cache, projectId), [cache]);

  const enqueueAll = useCallback(
    async (changes: NewChange[]) => {
      for (const change of changes) await queue.enqueue(change);
      await syncWaiting();
      await afterEnqueue();
    },
    [queue, syncWaiting, afterEnqueue],
  );

  const usable = () => readyRef.current && loadedOwnerRef.current !== null;

  /** The draft as shown, when it can still be edited (a converted draft is read-only). */
  const editable = useCallback((projectId: string, draftId: string) => {
    const found = draftsShown(projectId).find((d) => d.id === draftId);
    return found && found.convertedAt === null ? found : null;
  }, [draftsShown]);

  const createDraft = useCallback<DraftsContextValue["createDraft"]>(
    async (projectId, input) => {
      if (!usable()) return { ok: false };
      const name = input.name.trim();
      const sizes = sortedSizes(input.sizes);
      const note = input.note ?? "";
      const expectedPrice = input.expectedPrice ?? null;
      if (name.length === 0 || name.length > NAME_MAX || sizes.length === 0 || note.length > NOTE_MAX || !validPrice(expectedPrice)) return { ok: false };
      const id = newId();
      await enqueueAll([draftCreateChange({ id, projectId, name, sizes, expectedPrice, note, now: new Date() })]);
      return { ok: true, id };
    },
    [enqueueAll],
  );

  const addServerDraft = useCallback<DraftsContextValue["addServerDraft"]>(
    async (projectId, draft) => {
      if (!usable() || cacheRef.current.byProject[projectId] === undefined) return;
      await commit(projectId, withDraft(draftsOf(cacheRef.current, projectId), draft));
    },
    [commit],
  );

  const editDraft = useCallback<DraftsContextValue["editDraft"]>(
    async (projectId, draftId, fields) => {
      if (!usable()) return { ok: false };
      const current = editable(projectId, draftId);
      if (!current) return { ok: false };
      // Only what really changed is queued, so an unchanged field never gets a newer time than another phone's edit.
      const changed: DraftFieldChanges = {};
      if (fields.name !== undefined) {
        const name = fields.name.trim();
        if (name.length === 0 || name.length > NAME_MAX) return { ok: false };
        if (name !== current.name) changed.name = name;
      }
      if (fields.sizes !== undefined) {
        const sizes = sortedSizes(fields.sizes);
        if (sizes.length === 0) return { ok: false };
        if (sizes.join() !== current.sizes.join()) changed.sizes = sizes;
      }
      if (fields.expectedPrice !== undefined) {
        if (!validPrice(fields.expectedPrice)) return { ok: false };
        if (fields.expectedPrice !== current.expectedPrice) changed.expectedPrice = fields.expectedPrice;
      }
      if (fields.note !== undefined) {
        if (fields.note.length > NOTE_MAX) return { ok: false };
        if (fields.note !== current.note) changed.note = fields.note;
      }
      if (Object.keys(changed).length > 0) await enqueueAll([draftUpdateChange({ id: draftId, projectId, fields: changed, now: new Date() })]);
      return { ok: true };
    },
    [editable, enqueueAll],
  );

  const setDraftStatus = useCallback<DraftsContextValue["setDraftStatus"]>(
    async (projectId, draftId, status) => {
      if (!usable()) return { ok: false };
      const current = editable(projectId, draftId);
      if (!current) return { ok: false };
      if (current.status !== status) await enqueueAll([draftStatusChange({ id: draftId, projectId, value: status, now: new Date() })]);
      return { ok: true };
    },
    [editable, enqueueAll],
  );

  const deleteDraft = useCallback<DraftsContextValue["deleteDraft"]>(
    async (projectId, draftId) => {
      if (!readyRef.current) return;
      if (!draftsShown(projectId).some((d) => d.id === draftId)) return;
      // Line and status changes still waiting for this draft have nothing left to apply to.
      for (const change of await queue.waiting()) {
        if (change.entity === DRAFT_STATUS_ENTITY && change.entityId === draftId) await queue.dropEntity(DRAFT_STATUS_ENTITY, draftId);
        if (change.entity === DRAFT_LINE_ENTITY && change.data.draftId === draftId) await queue.dropEntity(DRAFT_LINE_ENTITY, change.entityId);
      }
      await enqueueAll([draftDeleteChange({ id: draftId, projectId })]);
    },
    [draftsShown, queue, enqueueAll],
  );

  const addLine = useCallback<DraftsContextValue["addLine"]>(
    async (projectId, draftId, line) => {
      if (!usable()) return { ok: false };
      const current = editable(projectId, draftId);
      if (!current || !Number.isFinite(line.amount) || line.amount <= 0) return { ok: false };
      const id = newId();
      const now = new Date();
      if (line.kind === "existing") {
        if (current.lines.some((l) => l.ingredientId === line.ingredientId)) return { ok: false };
        await enqueueAll([draftLineCreateChange({ draftId, projectId, line: { id, kind: "existing", ingredientId: line.ingredientId, amount: line.amount }, now })]);
        return { ok: true, id };
      }
      const newName = line.newName.trim();
      const purchaseQty = line.purchaseQty ?? null;
      const purchasePrice = line.purchasePrice ?? null;
      if (newName.length === 0 || !validQty(purchaseQty) || !validPrice(purchasePrice)) return { ok: false };
      await enqueueAll([
        draftLineCreateChange({ draftId, projectId, line: { id, kind: "new", newName, newKind: line.newKind, purchaseQty, purchasePrice, amount: line.amount }, now }),
      ]);
      return { ok: true, id };
    },
    [editable, enqueueAll],
  );

  const editLine = useCallback<DraftsContextValue["editLine"]>(
    async (projectId, draftId, lineId, fields) => {
      if (!usable()) return { ok: false };
      const current = editable(projectId, draftId)?.lines.find((l) => l.id === lineId);
      if (!current) return { ok: false };
      const changed: DraftLineFieldChanges = {};
      if (fields.amount !== undefined) {
        if (!Number.isFinite(fields.amount) || fields.amount <= 0) return { ok: false };
        if (fields.amount !== current.amount) changed.amount = fields.amount;
      }
      if (fields.newName !== undefined) {
        const name = fields.newName.trim();
        if (current.kind !== "new" || name.length === 0) return { ok: false };
        if (name !== current.newName) changed.newName = name;
      }
      if (fields.newKind !== undefined) {
        if (current.kind !== "new") return { ok: false };
        if (fields.newKind !== current.newKind) changed.newKind = fields.newKind;
      }
      if (fields.purchaseQty !== undefined) {
        if (current.kind !== "new" || !validQty(fields.purchaseQty)) return { ok: false };
        if (fields.purchaseQty !== current.purchaseQty) changed.purchaseQty = fields.purchaseQty;
      }
      if (fields.purchasePrice !== undefined) {
        if (current.kind !== "new" || !validPrice(fields.purchasePrice)) return { ok: false };
        if (fields.purchasePrice !== current.purchasePrice) changed.purchasePrice = fields.purchasePrice;
      }
      if (Object.keys(changed).length > 0) await enqueueAll([draftLineUpdateChange({ draftId, projectId, lineId, fields: changed, now: new Date() })]);
      return { ok: true };
    },
    [editable, enqueueAll],
  );

  const removeLine = useCallback<DraftsContextValue["removeLine"]>(
    async (projectId, draftId, lineId) => {
      if (!readyRef.current) return;
      if (!editable(projectId, draftId)?.lines.some((l) => l.id === lineId)) return;
      await enqueueAll([draftLineDeleteChange({ draftId, projectId, lineId })]);
    },
    [editable, enqueueAll],
  );

  const refresh = useCallback<DraftsContextValue["refresh"]>(
    async (projectId) => {
      if (!readyRef.current) return "skipped";
      return runExclusive(async () => {
        await cycle.idle();
        return cycle.refresh(projectId);
      });
    },
    [runExclusive, cycle],
  );

  const convertDraft = useCallback<DraftsContextValue["convertDraft"]>(
    async (projectId, draftId) => {
      if (!readyRef.current) return { ok: false, code: "not_ready" };
      // Send what is waiting first, so the server converts what the person sees.
      await afterEnqueue();
      const result = await runExclusive(async (): Promise<ConvertResult> => {
        await cycle.idle();
        const stillWaiting = (await queue.waiting()).some(
          (c) => c.data.projectId === projectId && (c.entityId === draftId || c.data.draftId === draftId),
        );
        if (stillWaiting) return { ok: false, code: "pending" };
        return runConvert({ getToken, convertDraft: apiConvertDraft }, projectId, draftId);
      });
      if (!result.ok) {
        if (result.code === "not_signed_in") notSignedInRef.current();
        if (!shouldRefreshAfter(result.code)) return result;
        // The request may have gone through (a repeat tap, or a reply lost on the way): look at the server's copy.
        await Promise.allSettled([refresh(projectId), refreshProducts(projectId), refreshIngredients(projectId)]);
        const fresh = draftsOf(cacheRef.current, projectId).find((d) => d.id === draftId);
        return recoveredConvert(result, fresh) ?? result;
      }
      // The draft now has a product, and new ingredients may exist: bring all three lists up to date.
      await Promise.allSettled([refresh(projectId), refreshProducts(projectId), refreshIngredients(projectId)]);
      return result;
    },
    [afterEnqueue, runExclusive, cycle, queue, refresh, refreshProducts, refreshIngredients],
  );

  const dismissRejectedNotice = useCallback(() => setRejectedNotice(null), []);

  const value = useMemo<DraftsContextValue>(
    () => ({
      ready,
      loadedFor,
      draftsFor,
      convertedTotalFor,
      draftPendingFor,
      createDraft,
      addServerDraft,
      editDraft,
      setDraftStatus,
      deleteDraft,
      addLine,
      editLine,
      removeLine,
      convertDraft,
      refresh,
      rejectedNotice,
      dismissRejectedNotice,
    }),
    [ready, loadedFor, draftsFor, convertedTotalFor, draftPendingFor, createDraft, addServerDraft, editDraft, setDraftStatus, deleteDraft, addLine, editLine, removeLine, convertDraft, refresh, rejectedNotice, dismissRejectedNotice],
  );

  return <DraftsContext.Provider value={value}>{children}</DraftsContext.Provider>;
}
