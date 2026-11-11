import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "../auth/AuthProvider";
import { getToken } from "../auth/token-store";
import { ApiError } from "../lib/api";
import { asyncStorageStore } from "../sync/asyncStorageStore";
import { createQueue, type Change } from "../sync/queue";
import { startSyncTriggers } from "../sync/triggers";
import { listProjects, type Project } from "./api";
import { changedFields, ownershipDecision } from "./optimistic";
import * as outcomes from "./outcomes";
import type { RejectedNotice } from "./outcomes";
import { newProjectId } from "./newProjectId";
import {
  clearProjectCache,
  loadProjectCache,
  saveProjectCache,
  validateProjectInput,
  type ProjectInput,
  type ProjectInputErrors,
} from "./store";
import { PROJECT_ENTITY, registerProjectEntity } from "./sync";

export type ProjectsStatus = "loading" | "ready" | "offline";

export type { RejectedNotice, RejectedReason } from "./outcomes";

/** `errors` uses the same shape as validateProjectInput. */
export type MutationResult<T = object> = ({ ok: true } & T) | { ok: false; errors: ProjectInputErrors };

type ProjectsContextValue = {
  /** "loading" until the first refresh ends; the cached `projects` are already shown meanwhile. */
  status: ProjectsStatus;
  projects: Project[];
  currentProject: Project | null;
  currentProjectId: string | null;
  setCurrentProject: (id: string | null) => Promise<void>;
  create: (input: ProjectInput) => Promise<MutationResult<{ id: string }>>;
  update: (id: string, fields: Partial<ProjectInput>) => Promise<MutationResult>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Changes made on this phone that the server has not accepted yet. */
  waitingCount: number;
  rejectedNotice: RejectedNotice | null;
  dismissRejectedNotice: () => void;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function useProjects(): ProjectsContextValue {
  const value = useContext(ProjectsContext);
  if (!value) throw new Error("useProjects must be used inside ProjectsProvider");
  return value;
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { registerSignOutCleanup, handleNotSignedIn, retryProfile } = auth;
  const signedIn = auth.status === "signedIn";
  const profileKnown = auth.profileStatus !== "loading";
  const userId = auth.user?.id ?? null;

  const [status, setStatus] = useState<ProjectsStatus>("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentId] = useState<string | null>(null);
  const [waitingCount, setWaitingCount] = useState(0);
  const [rejectedNotice, setRejectedNotice] = useState<RejectedNotice | null>(null);
  const [ready, setReady] = useState(false);

  const projectsRef = useRef<Project[]>([]);
  const currentRef = useRef<string | null>(null);
  const cacheOwnerRef = useRef<string | null>(null);
  const genRef = useRef(0);
  /** True from the user's sign-out until the next sign-in loads; late results must not write storage. */
  const wipedRef = useRef(false);
  const mutationSeq = useRef(0);
  const inflight = useRef(new Set<Promise<unknown>>());
  const exclusive = useRef<Promise<unknown>>(Promise.resolve());
  const applyChain = useRef<Promise<unknown>>(Promise.resolve());
  const needsRefresh = useRef(false);
  const notSignedInRef = useRef<() => void>(() => {});
  useEffect(() => {
    notSignedInRef.current = () => void handleNotSignedIn();
  }, [handleNotSignedIn]);

  const persist = useCallback(async () => {
    if (wipedRef.current) return;
    try {
      await saveProjectCache(asyncStorageStore, {
        userId: cacheOwnerRef.current ?? "",
        projects: projectsRef.current,
        currentProjectId: currentRef.current,
      });
    } catch {
      // Storage failure: the screen still shows the in-memory list.
    }
  }, []);

  /** Shows `list`, forgets a remembered project that is gone (R29), and saves. */
  const commit = useCallback(
    (list: Project[]) => {
      projectsRef.current = list;
      setProjects(list);
      if (currentRef.current !== null && !list.some((p) => p.id === currentRef.current)) {
        currentRef.current = null;
        setCurrentId(null);
      }
      return persist();
    },
    [persist],
  );

  const [queue] = useState(() => {
    const q: ReturnType<typeof createQueue> = createQueue({
      store: asyncStorageStore,
      getToken,
      onApplied: (change: Change, response: unknown) => {
        applyChain.current = applyChain.current.then(async () => {
          if (wipedRef.current) return;
          const next = outcomes.onApplied(
            projectsRef.current,
            change,
            response as Project | undefined,
            await q.waiting(),
          );
          await commit(next);
          setWaitingCount(await q.count());
        });
      },
      onRejected: (change: Change, error: ApiError) => {
        applyChain.current = applyChain.current.then(async () => {
          if (wipedRef.current) return;
          const outcome = outcomes.onRejected(projectsRef.current, change, error, await q.waiting());
          setRejectedNotice(outcome.notice);
          if (outcome.needsRefresh) needsRefresh.current = true; // restores the server's version
          await commit(outcome.list);
          setWaitingCount(await q.count());
        });
      },
      onSignedOut: () => notSignedInRef.current(),
    });
    registerProjectEntity(q);
    return q;
  });

  const runExclusive = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const result = exclusive.current.then(task, task);
    exclusive.current = result.catch(() => {});
    return result;
  }, []);

  const refreshInner = useCallback(async () => {
    const gen = genRef.current;
    const token = await getToken();
    if (!token || gen !== genRef.current) return;
    try {
      const server = await listProjects(token);
      // Wait out any change being recorded so the overlay always includes it.
      let waiting: Change[];
      for (;;) {
        while (inflight.current.size > 0) await Promise.all([...inflight.current]);
        const seq = mutationSeq.current;
        waiting = await queue.waiting();
        if (seq === mutationSeq.current && inflight.current.size === 0) break;
      }
      if (gen !== genRef.current) return;
      await commit(outcomes.restoreFromServer(server, waiting));
      setWaitingCount(waiting.length);
      setStatus("ready");
    } catch (error) {
      if (gen !== genRef.current) return;
      if (error instanceof ApiError && error.code === "not_signed_in") notSignedInRef.current();
      else if (error instanceof ApiError && error.code === "network") setStatus("offline");
      else setStatus((s) => (s === "loading" ? "ready" : s));
    }
  }, [commit, queue]);

  /** `requestedGen` is the generation when the sync was asked for; a session change since then cancels it. */
  const flushInner = useCallback(async (requestedGen: number = genRef.current) => {
    const gen = genRef.current;
    if (requestedGen !== gen) return;
    needsRefresh.current = false;
    if (!userId) return; // cannot tell whose changes are waiting: send nothing
    await queue.flush(userId);
    await applyChain.current;
    if (gen !== genRef.current) return;
    setWaitingCount(await queue.count());
    if (needsRefresh.current) {
      needsRefresh.current = false;
      await refreshInner();
    }
  }, [queue, refreshInner, userId]);

  const flush = useCallback(() => {
    const requested = genRef.current;
    return runExclusive(() => flushInner(requested));
  }, [runExclusive, flushInner]);
  const refresh = useCallback(() => runExclusive(refreshInner), [runExclusive, refreshInner]);
  const syncNow = useCallback(async () => {
    // Without a known user nothing can be sent. Try to learn who it is first (offline launch);
    // once known, the ownership effect starts a full sync by itself.
    if (!userId && (await retryProfile())) return;
    const requested = genRef.current;
    await runExclusive(async () => {
      await flushInner(requested);
      await refreshInner();
    });
  }, [userId, retryProfile, runExclusive, flushInner, refreshInner]);
  const syncRef = useRef(syncNow);
  useEffect(() => {
    syncRef.current = syncNow;
  }, [syncNow]);

  const resetMemory = useCallback(() => {
    genRef.current += 1;
    projectsRef.current = [];
    currentRef.current = null;
    cacheOwnerRef.current = null;
    needsRefresh.current = false;
    setProjects([]);
    setCurrentId(null);
    setWaitingCount(0);
    setRejectedNotice(null);
    setStatus("loading");
    setReady(false);
  }, []);

  // Load the local copy, settle ownership, then refresh and send waiting changes.
  useEffect(() => {
    if (!signedIn || !profileKnown) return;
    let cancelled = false;
    wipedRef.current = false;
    void (async () => {
      let cache = await loadProjectCache(asyncStorageStore);
      if (userId) {
        let cleared = false;
        try {
          cleared = await queue.setOwner(userId);
        } catch {
          // Unreadable queue: keep going with what is in memory.
        }
        if (ownershipDecision(cache?.userId || null, cleared, userId) === "clear") {
          try {
            await clearProjectCache(asyncStorageStore);
          } catch {
            // Overwritten by the next save.
          }
          cache = null;
        }
        cacheOwnerRef.current = userId;
      } else {
        cacheOwnerRef.current = cache?.userId || null;
      }
      if (cancelled) return;
      projectsRef.current = cache?.projects ?? [];
      currentRef.current = cache?.currentProjectId ?? null;
      setProjects(projectsRef.current);
      setCurrentId(currentRef.current);
      try {
        setWaitingCount(await queue.count());
      } catch {
        // Count stays 0.
      }
      if (cancelled) return;
      setReady(true);
      void syncRef.current();
    })();
    return () => {
      cancelled = true;
      // The session ended or the user changed: drop in-memory state only. Stored data stays
      // for a 401; the user's own sign-out wipes it in the registered cleanup.
      resetMemory();
    };
  }, [signedIn, profileKnown, userId, queue, resetMemory]);

  useEffect(() => {
    if (!ready) return;
    return startSyncTriggers(() => void syncRef.current());
  }, [ready]);

  // The user's sign-out: local copy, queue, owner and remembered project all go (R28).
  useEffect(() => {
    return registerSignOutCleanup(async () => {
      wipedRef.current = true;
      genRef.current += 1;
      try {
        await clearProjectCache(asyncStorageStore);
      } catch {
        // Best effort.
      }
      try {
        await queue.clear({ owner: true });
      } catch {
        // Best effort.
      }
      resetMemory();
    });
  }, [registerSignOutCleanup, queue, resetMemory]);

  const track = useCallback(async (task: () => Promise<unknown>) => {
    mutationSeq.current += 1;
    const p = task();
    inflight.current.add(p);
    try {
      await p;
    } finally {
      inflight.current.delete(p);
      mutationSeq.current += 1;
    }
  }, []);

  const afterEnqueue = useCallback(async () => {
    setWaitingCount(await queue.count());
    void flush();
  }, [queue, flush]);

  const create = useCallback<ProjectsContextValue["create"]>(
    async (input) => {
      const result = validateProjectInput(input);
      if (!result.ok) return result;
      const id = newProjectId();
      const project: Project = { id, ...result.value, role: "owner" };
      await track(async () => {
        await queue.enqueue({ entity: PROJECT_ENTITY, entityId: id, kind: "create", data: { ...result.value } });
        void commit([...projectsRef.current.filter((p) => p.id !== id), project]);
      });
      await afterEnqueue();
      return { ok: true, id };
    },
    [track, commit, queue, afterEnqueue],
  );

  const update = useCallback<ProjectsContextValue["update"]>(
    async (id, fields) => {
      const current = projectsRef.current.find((p) => p.id === id);
      if (!current) return { ok: true };
      const result = validateProjectInput({
        name: fields.name ?? current.name,
        description: fields.description ?? current.description,
        currency: fields.currency ?? current.currency,
      });
      if (!result.ok) return result;
      const changed = changedFields(current, result.value);
      if (Object.keys(changed).length === 0) return { ok: true };
      await track(async () => {
        await queue.enqueue({ entity: PROJECT_ENTITY, entityId: id, kind: "update", data: { ...changed } });
        void commit(projectsRef.current.map((p) => (p.id === id ? { ...p, ...changed } : p)));
      });
      await afterEnqueue();
      return { ok: true };
    },
    [track, commit, queue, afterEnqueue],
  );

  const remove = useCallback(
    async (id: string) => {
      await track(async () => {
        await queue.enqueue({ entity: PROJECT_ENTITY, entityId: id, kind: "delete", data: {} });
        void commit(projectsRef.current.filter((p) => p.id !== id));
      });
      await afterEnqueue();
    },
    [track, commit, queue, afterEnqueue],
  );

  const setCurrentProject = useCallback(
    async (id: string | null) => {
      currentRef.current = id;
      setCurrentId(id);
      await persist();
    },
    [persist],
  );

  const dismissRejectedNotice = useCallback(() => setRejectedNotice(null), []);

  const currentProject = useMemo(
    () => projects.find((p) => p.id === currentProjectId) ?? null,
    [projects, currentProjectId],
  );

  const value = useMemo<ProjectsContextValue>(
    () => ({
      status,
      projects,
      currentProject,
      currentProjectId,
      setCurrentProject,
      create,
      update,
      remove,
      refresh,
      waitingCount,
      rejectedNotice,
      dismissRejectedNotice,
    }),
    [
      status,
      projects,
      currentProject,
      currentProjectId,
      setCurrentProject,
      create,
      update,
      remove,
      refresh,
      waitingCount,
      rejectedNotice,
      dismissRejectedNotice,
    ],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}
