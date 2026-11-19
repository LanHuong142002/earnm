import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthProvider";
import { getStoredUserId, getToken } from "../auth/token-store";
import { newProjectId as newId } from "../projects/newProjectId";
import { useProjects } from "../projects/ProjectsProvider";
import { asyncStorageStore } from "../sync/asyncStorageStore";
import type { Change, NewChange } from "../sync/queue";
import { clearCommentCache, pruneCommentCache, updateCommentCache } from "../tasks/comments/store";
import { registerCommentEntity } from "../tasks/comments/sync";
import { photoDeps } from "../tasks/photos/realDeps";
import { clearPhotoCache, prunePhotoCache, updatePhotoCache } from "../tasks/photos/store";
import { registerPhotoEntities } from "../tasks/photos/uploads";
import { queueTaskLabels } from "../tasks/waitingLabels";
import { IDEA_COMMENTS, IDEA_PHOTOS } from "./adapters";
import { ideaCommentsApi, ideaPhotosApi, listIdeas } from "./api";
import { IDEA_LABELS_ENTITY, IDEA_VOTE_ENTITY } from "./entities";
import { applyIdeaOverlay, pendingIdeaIds } from "./overlay";
import { planIdeaCreate, planIdeaDelete, planIdeaUpdate, planVote, type IdeaEdit, type IdeaInput, type IdeaInputErrors } from "./plan";
import {
  clearIdeaCache,
  emptyIdeaCache,
  hasIdeas,
  ideasOf,
  openIdeaCache,
  pruneIdeaCache,
  saveIdeaCache,
  setProjectIdeas,
  type IdeaCache,
} from "./store";
import { createIdeaSyncCycle, type IdeaRefreshResult, type IdeaRejectedNotice } from "./syncCycle";
import { registerIdeaEntities } from "./sync";
import { IDEA_STATUSES, type Idea, type IdeaStatus } from "./types";

export type { IdeaRefreshResult, IdeaRejectedNotice } from "./syncCycle";
export type { IdeaEdit, IdeaInput, IdeaInputErrors } from "./plan";

/** `errors` has the same shape as `validateIdeaInput`; it is empty when the provider is not `ready` yet. */
export type IdeaMutationResult<T = object> = ({ ok: true } & T) | { ok: false; errors: IdeaInputErrors };

type IdeasContextValue = {
  /** True once the local copy for the signed-in person is loaded. Mutations and refresh wait for it. */
  ready: boolean;
  /** Whether the project's ideas are known (cached or fetched). Until then a screen shows its skeleton. */
  loadedFor: (projectId: string) => boolean;
  /** The project's ideas with the waiting changes laid over them. Not sorted or filtered (see `order.ts`, `filters.ts`). */
  ideasFor: (projectId: string) => Idea[];
  /** The ideas of the project with a change waiting ("Chờ lưu"). */
  pendingFor: (projectId: string) => ReadonlySet<string>;
  create: (projectId: string, input: IdeaInput) => Promise<IdeaMutationResult<{ id: string }>>;
  /** Title, description and labels are for the author and Owners (the server refuses others); status is for any member. */
  update: (projectId: string, ideaId: string, edit: IdeaEdit) => Promise<IdeaMutationResult>;
  setStatus: (projectId: string, ideaId: string, status: IdeaStatus) => Promise<IdeaMutationResult>;
  /** Presses the up (`1`) or down (`-1`) arrow: pressing your own vote again takes it back. */
  vote: (projectId: string, ideaId: string, pressed: 1 | -1) => Promise<void>;
  remove: (projectId: string, ideaId: string) => Promise<void>;
  /** Fetches the project's ideas and saves them. "skipped" until `ready`. */
  refresh: (projectId: string) => Promise<IdeaRefreshResult>;
  rejectedNotice: IdeaRejectedNotice | null;
  dismissRejectedNotice: () => void;
};

const IdeasContext = createContext<IdeasContextValue | null>(null);

export function useIdeas(): IdeasContextValue {
  const value = useContext(IdeasContext);
  if (!value) throw new Error("useIdeas must be used inside IdeasProvider");
  return value;
}

export function IdeasProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { registerSignOutCleanup, handleNotSignedIn } = auth;
  const signedIn = auth.status === "signedIn";
  const userId = auth.user?.id ?? null;
  // The saved name counts while the profile has not answered, so "me" is always known to a change.
  const meId = auth.identity?.id ?? null;
  const displayName = auth.identity?.displayName ?? null;
  const { sync, projects, status: projectsStatus } = useProjects();
  const { queue, afterEnqueue, onFlushed, runExclusive } = sync;

  const [cache, setCache] = useState<IdeaCache>(() => emptyIdeaCache(""));
  const [waiting, setWaiting] = useState<Change[]>([]);
  const [ready, setReady] = useState(false);
  const [rejectedNotice, setRejectedNotice] = useState<IdeaRejectedNotice | null>(null);

  const cacheRef = useRef<IdeaCache>(cache);
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
  const publish = useCallback((next: IdeaCache): Promise<unknown> => {
    cacheRef.current = next;
    setCache(next);
    if (wipedRef.current || loadedOwnerRef.current === null) return Promise.resolve();
    const write = saveChain.current
      .catch(() => {})
      .then(() => (wipedRef.current ? undefined : saveIdeaCache(asyncStorageStore, cacheRef.current)))
      .catch(() => {
        // Storage failure: the screen still shows the in-memory list.
      });
    saveChain.current = write;
    return write;
  }, []);

  const commit = useCallback(
    (projectId: string, list: Idea[]) => publish(setProjectIdeas(cacheRef.current, projectId, list)),
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
    const c = createIdeaSyncCycle({
      getToken,
      listIdeas,
      getIdeas: (projectId) => cacheRef.current.byProject[projectId] ?? null,
      commit,
      setNotice: setRejectedNotice,
      getGeneration: () => genRef.current,
      isWiped: () => wipedRef.current,
      onNotSignedIn: () => notSignedInRef.current(),
    });
    registerIdeaEntities(queue, c.handlers);
    // Idea comments and photos keep their own refusals (retry or discard each), not the notice, like a task's.
    registerCommentEntity(queue, asyncStorageStore, ideaCommentsApi, IDEA_COMMENTS);
    registerPhotoEntities(queue, asyncStorageStore, { ...photoDeps, ...ideaPhotosApi }, IDEA_PHOTOS);
    return c;
  });

  const resetMemory = useCallback(() => {
    genRef.current += 1;
    const empty = emptyIdeaCache("");
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
  // another person is removed by openIdeaCache.
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
          // Unreadable: no saved ideas are shown until the profile is known.
        }
      }
      if (cancelled || !owner) return;
      let opened: IdeaCache;
      try {
        opened = await openIdeaCache(asyncStorageStore, owner);
      } catch {
        opened = emptyIdeaCache(owner);
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

  // The user's sign-out: every local idea copy goes, with the comments and photos kept for ideas.
  useEffect(() => {
    return registerSignOutCleanup(async () => {
      wipedRef.current = true;
      genRef.current += 1;
      try {
        await clearIdeaCache(asyncStorageStore);
        await clearCommentCache(asyncStorageStore, IDEA_COMMENTS);
        await clearPhotoCache(asyncStorageStore, IDEA_PHOTOS);
      } catch {
        // Best effort.
      }
      resetMemory();
    });
  }, [registerSignOutCleanup, resetMemory]);

  // Forget the ideas of projects that are no longer in the project list. Only once the project list itself has
  // been confirmed by the server, so a cached or empty list never prunes anything.
  useEffect(() => {
    if (!ready || projectsStatus !== "ready") return;
    const ids = projects.map((p) => p.id);
    const pruned = pruneIdeaCache(cacheRef.current, ids);
    if (Object.keys(pruned.byProject).length !== Object.keys(cacheRef.current.byProject).length) void publish(pruned);
    const owner = loadedOwnerRef.current;
    if (owner) {
      void updateCommentCache(asyncStorageStore, owner, (c) => pruneCommentCache(c, ids), IDEA_COMMENTS).catch(() => {});
      void updatePhotoCache(asyncStorageStore, owner, (c) => prunePhotoCache(c, ids), IDEA_PHOTOS).catch(() => {});
    }
  }, [ready, projectsStatus, projects, publish]);

  const me = useMemo(() => (meId && displayName !== null ? { id: meId, displayName } : null), [meId, displayName]);

  /** The project's ideas as shown: the server's with the waiting changes laid over. */
  const shown = useCallback((projectId: string) => applyIdeaOverlay(projectId, ideasOf(cacheRef.current, projectId), waiting), [waiting]);

  const ideasFor = useCallback<IdeasContextValue["ideasFor"]>(
    (projectId) => applyIdeaOverlay(projectId, ideasOf(cache, projectId), waiting),
    [cache, waiting],
  );
  const pendingFor = useCallback<IdeasContextValue["pendingFor"]>((projectId) => pendingIdeaIds(projectId, waiting), [waiting]);
  const loadedFor = useCallback<IdeasContextValue["loadedFor"]>((projectId) => hasIdeas(cache, projectId), [cache]);

  /** Queues every change of a plan, in order. A label set is queued so it can never run before a label it names. */
  const enqueueAll = useCallback(
    async (changes: NewChange[]) => {
      for (const change of changes) {
        if (change.entity === IDEA_LABELS_ENTITY) await queueTaskLabels(queue, change);
        else await queue.enqueue(change);
      }
      await syncWaiting();
      await afterEnqueue();
    },
    [queue, syncWaiting, afterEnqueue],
  );

  const create = useCallback<IdeasContextValue["create"]>(
    async (projectId, input) => {
      if (!readyRef.current || !loadedOwnerRef.current) return { ok: false, errors: {} };
      const id = newId();
      const plan = planIdeaCreate({ id, projectId, input, author: me, now: new Date() });
      if (!plan.ok) return plan;
      await enqueueAll(plan.changes);
      return { ok: true, id };
    },
    [me, enqueueAll],
  );

  const update_ = useCallback<IdeasContextValue["update"]>(
    async (projectId, ideaId, edit) => {
      if (!readyRef.current || !loadedOwnerRef.current) return { ok: false, errors: {} };
      const current = shown(projectId).find((i) => i.id === ideaId);
      if (!current) return { ok: true };
      const plan = planIdeaUpdate(current, edit, new Date());
      if (!plan.ok) return plan;
      if (plan.changes.length > 0) await enqueueAll(plan.changes);
      return { ok: true };
    },
    [shown, enqueueAll],
  );

  const setStatus = useCallback<IdeasContextValue["setStatus"]>(
    async (projectId, ideaId, status) => {
      if (!(IDEA_STATUSES as readonly string[]).includes(status)) return { ok: false, errors: {} };
      return update_(projectId, ideaId, { status });
    },
    [update_],
  );

  const vote = useCallback<IdeasContextValue["vote"]>(
    async (projectId, ideaId, pressed) => {
      if (!readyRef.current) return;
      const current = shown(projectId).find((i) => i.id === ideaId);
      if (!current) return;
      await enqueueAll([planVote(current, pressed, new Date())]);
    },
    [shown, enqueueAll],
  );

  const remove = useCallback<IdeasContextValue["remove"]>(
    async (projectId, ideaId) => {
      if (!readyRef.current) return;
      const current = shown(projectId).find((i) => i.id === ideaId);
      if (!current) return;
      // A label set or a vote for an idea that is going away has nowhere to go.
      await queue.dropEntity(IDEA_LABELS_ENTITY, ideaId);
      await queue.dropEntity(IDEA_VOTE_ENTITY, ideaId);
      await enqueueAll([planIdeaDelete(current)]);
    },
    [shown, queue, enqueueAll],
  );

  const refresh = useCallback<IdeasContextValue["refresh"]>(
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

  const value = useMemo<IdeasContextValue>(
    () => ({
      ready,
      loadedFor,
      ideasFor,
      pendingFor,
      create,
      update: update_,
      setStatus,
      vote,
      remove,
      refresh,
      rejectedNotice,
      dismissRejectedNotice,
    }),
    [ready, loadedFor, ideasFor, pendingFor, create, update_, setStatus, vote, remove, refresh, rejectedNotice, dismissRejectedNotice],
  );

  return <IdeasContext.Provider value={value}>{children}</IdeasContext.Provider>;
}
