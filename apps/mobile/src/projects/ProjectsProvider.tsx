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
import { asyncStorageStore } from "../sync/asyncStorageStore";
import { createQueue } from "../sync/queue";
import { startSyncTriggers } from "../sync/triggers";
import { listProjects, type Project } from "./api";
import { ownershipDecision, planUpdate } from "./optimistic";
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
import { createSyncCycle } from "./syncCycle";

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

  const [{ queue, cycle }] = useState(() => {
    const holder: { queue: ReturnType<typeof createQueue> | null } = { queue: null };
    const c = createSyncCycle({
      getQueue: () => holder.queue as ReturnType<typeof createQueue>,
      getToken,
      listProjects,
      getProjects: () => projectsRef.current,
      commit,
      setNotice: setRejectedNotice,
      setWaitingCount,
      setStatus,
      getGeneration: () => genRef.current,
      isWiped: () => wipedRef.current,
      // Wait out any change being recorded so the overlay always includes it.
      settleMutations: async () => {
        for (;;) {
          while (inflight.current.size > 0) await Promise.all([...inflight.current]);
          const seq = mutationSeq.current;
          const waiting = await (holder.queue as ReturnType<typeof createQueue>).waiting();
          if (seq === mutationSeq.current && inflight.current.size === 0) return waiting;
        }
      },
      onNotSignedIn: () => notSignedInRef.current(),
    });
    const q = createQueue({ store: asyncStorageStore, getToken, ...c.handlers });
    holder.queue = q;
    registerProjectEntity(q);
    return { queue: q, cycle: c };
  });

  const runExclusive = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const result = exclusive.current.then(task, task);
    exclusive.current = result.catch(() => {});
    return result;
  }, []);

  const flush = useCallback(() => {
    const requested = genRef.current;
    return runExclusive(() => cycle.flush(userId, requested));
  }, [runExclusive, cycle, userId]);
  const refresh = useCallback(() => runExclusive(() => cycle.refresh()), [runExclusive, cycle]);
  const syncNow = useCallback(async () => {
    // Without a known user nothing can be sent. Try to learn who it is first (offline launch);
    // once known, the ownership effect starts a full sync by itself.
    if (!userId && (await retryProfile())) return;
    const requested = genRef.current;
    await runExclusive(() => cycle.sync(userId, requested));
  }, [userId, retryProfile, runExclusive, cycle]);
  const syncRef = useRef(syncNow);
  useEffect(() => {
    syncRef.current = syncNow;
  }, [syncNow]);

  const resetMemory = useCallback(() => {
    genRef.current += 1;
    projectsRef.current = [];
    currentRef.current = null;
    cacheOwnerRef.current = null;
    cycle.reset();
    setProjects([]);
    setCurrentId(null);
    setWaitingCount(0);
    setRejectedNotice(null);
    setStatus("loading");
    setReady(false);
  }, [cycle]);

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
      const plan = planUpdate(current, fields);
      if (!plan.ok) return plan;
      const changed = plan.changed;
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
      setRejectedNotice(null); // a notice about another project must not follow the person here
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
