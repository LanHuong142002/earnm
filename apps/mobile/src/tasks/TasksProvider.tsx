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
import { getStoredUserId, getToken } from "../auth/token-store";
import { newProjectId as newId } from "../projects/newProjectId";
import { useProjects } from "../projects/ProjectsProvider";
import { asyncStorageStore } from "../sync/asyncStorageStore";
import { loadMembers } from "../members/memberCache";
import { listTasks } from "./api";
import { membersToAssignees } from "./assignees";
import { DEFAULT_FILTERS, type TaskFilters } from "./filters";
import { deriveMembers, showLocalChange } from "./localChange";
import { planTaskCreate, planTaskDelete, planTaskUpdate, type TaskEdit } from "./optimistic";
import type { TaskRejectedNotice } from "./outcomes";
import {
  clearTaskCache,
  emptyTaskCache,
  openTaskCache,
  pruneTaskCache,
  saveTaskCache,
  setProjectFilters,
  setProjectTasks,
  type TaskCache,
} from "./store";
import { registerTaskEntity } from "./sync";
import { createTaskSyncCycle, type RefreshResult } from "./syncCycle";
import type { Task, TaskAssignee, TaskStatus } from "./types";
import type { TaskInput, TaskInputErrors } from "./validate";

export type { TaskRejectedNotice } from "./outcomes";
export type { TaskFilters } from "./filters";
export type { TaskEdit } from "./optimistic";
export type { RefreshResult } from "./syncCycle";

/**
 * `errors` is the same shape as validateTaskInput. It is empty when the provider is not `ready`
 * (nobody to attribute the change to yet); screens only offer forms once `ready` is true.
 */
export type TaskMutationResult<T = object> = ({ ok: true } & T) | { ok: false; errors: TaskInputErrors };

type TasksContextValue = {
  /** True once the local copy for the signed-in person is loaded. Mutations and refresh wait for it. */
  ready: boolean;
  /** The cached list for a project, in server order then offline-created order. Not sorted or filtered. */
  tasksFor: (projectId: string) => Task[];
  filtersFor: (projectId: string) => TaskFilters;
  /** Remembered per project until sign-out (R24). */
  setFilters: (projectId: string, filters: TaskFilters) => Promise<void>;
  create: (projectId: string, input: TaskInput) => Promise<TaskMutationResult<{ id: string }>>;
  update: (projectId: string, taskId: string, edit: TaskEdit) => Promise<TaskMutationResult>;
  setStatus: (projectId: string, taskId: string, status: TaskStatus) => Promise<TaskMutationResult>;
  remove: (projectId: string, taskId: string) => Promise<void>;
  /** Fetches the project's tasks and shows them with waiting changes on top. "skipped" until `ready`. */
  refresh: (projectId: string) => Promise<RefreshResult>;
  rejectedNotice: TaskRejectedNotice | null;
  dismissRejectedNotice: () => void;
};

const TasksContext = createContext<TasksContextValue | null>(null);

export function useTasks(): TasksContextValue {
  const value = useContext(TasksContext);
  if (!value) throw new Error("useTasks must be used inside TasksProvider");
  return value;
}

type Props = {
  children: ReactNode;
  /**
   * Extra people per project, laid over the derived list (me and the assignees on cached tasks)
   * and the members in the members cache.
   */
  members?: (projectId: string) => TaskAssignee[];
};

export function TasksProvider({ children, members }: Props) {
  const auth = useAuth();
  const { registerSignOutCleanup, handleNotSignedIn } = auth;
  const signedIn = auth.status === "signedIn";
  const userId = auth.user?.id ?? null;
  const displayName = auth.user?.displayName ?? null;
  const { sync, projects, status: projectsStatus } = useProjects();
  const { queue, afterEnqueue, onFlushed, runExclusive } = sync;

  const [cache, setCache] = useState<TaskCache>(() => emptyTaskCache(""));
  const [ready, setReady] = useState(false);
  const [rejectedNotice, setRejectedNotice] = useState<TaskRejectedNotice | null>(null);

  const cacheRef = useRef<TaskCache>(cache);
  const readyRef = useRef(false);
  /** Whose copy `cacheRef` is; null until the owner check has run. */
  const loadedOwnerRef = useRef<string | null>(null);
  const genRef = useRef(0);
  /** True from the user's own sign-out until the next sign-in loads; late results must not write storage. */
  const wipedRef = useRef(false);
  const mutationSeq = useRef(0);
  const inflight = useRef(new Set<Promise<unknown>>());
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const membersRef = useRef(members);
  const notSignedInRef = useRef<() => void>(() => {});
  useEffect(() => {
    membersRef.current = members;
  }, [members]);
  useEffect(() => {
    notSignedInRef.current = () => void handleNotSignedIn();
  }, [handleNotSignedIn]);

  /** Shows and saves `next`. Saves are written one after another so an older copy never lands last. */
  const publish = useCallback((next: TaskCache): Promise<unknown> => {
    cacheRef.current = next;
    setCache(next);
    if (wipedRef.current || loadedOwnerRef.current === null) return Promise.resolve();
    const write = saveChain.current
      .catch(() => {})
      .then(() => {
        if (wipedRef.current) return undefined;
        return saveTaskCache(asyncStorageStore, cacheRef.current);
      })
      .catch(() => {
        // Storage failure: the screen still shows the in-memory list.
      });
    saveChain.current = write;
    return write;
  }, []);

  const commit = useCallback(
    (projectId: string, list: Task[]) => publish(setProjectTasks(cacheRef.current, projectId, list)),
    [publish],
  );

  const [cycle] = useState(() => {
    const c = createTaskSyncCycle({
      getQueue: () => queue,
      getToken,
      listTasks,
      getTasks: (projectId) => cacheRef.current.byProject[projectId] ?? [],
      commit,
      setNotice: setRejectedNotice,
      getGeneration: () => genRef.current,
      isWiped: () => wipedRef.current,
      // Wait out any change being recorded so the overlay always includes it.
      settleMutations: async () => {
        for (;;) {
          while (inflight.current.size > 0) await Promise.all([...inflight.current]);
          const seq = mutationSeq.current;
          const waiting = await queue.waiting();
          if (seq === mutationSeq.current && inflight.current.size === 0) return waiting;
        }
      },
      onNotSignedIn: () => notSignedInRef.current(),
    });
    registerTaskEntity(queue, c.handlers);
    return c;
  });

  const resetMemory = useCallback(() => {
    genRef.current += 1;
    const empty = emptyTaskCache("");
    cacheRef.current = empty;
    loadedOwnerRef.current = null;
    readyRef.current = false;
    cycle.reset();
    setCache(empty);
    setRejectedNotice(null);
    setReady(false);
  }, [cycle]);

  // Load the local copy once the person is known (the stored id when the profile is still offline).
  // Another person's copy, or any copy once the queue dropped another person's changes, is removed
  // by openTaskCache and an empty one is used (R19).
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
          // Unreadable: no saved tasks are shown until the profile is known.
        }
      }
      if (cancelled || !owner) return;
      let queueCleared = false;
      try {
        queueCleared = await queue.setOwner(owner);
      } catch {
        // Unreadable queue: keep going with what is in memory.
      }
      if (cancelled) return;
      let opened: TaskCache;
      try {
        opened = await openTaskCache(asyncStorageStore, owner, queueCleared);
      } catch {
        opened = emptyTaskCache(owner);
      }
      if (cancelled || wipedRef.current) return;
      cacheRef.current = opened;
      loadedOwnerRef.current = owner;
      setCache(opened);
      readyRef.current = true;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      // The session ended: drop in-memory state only. Stored data stays for a 401; the user's
      // own sign-out wipes it in the registered cleanup.
      resetMemory();
    };
  }, [signedIn, userId, queue, resetMemory]);

  // After each flush, fetch again the projects whose changes were refused (R17). Runs behind the
  // flush in the shared exclusive lane so a refresh never reads between a send and its result.
  useEffect(() => {
    return onFlushed(() => {
      if (!readyRef.current) return;
      void runExclusive(async () => {
        await cycle.idle();
        for (const projectId of cycle.pendingRefreshes()) await cycle.refresh(projectId);
      }).catch(() => {});
    });
  }, [onFlushed, runExclusive, cycle]);

  // The user's sign-out: every local task copy and the filter choices go (R19).
  useEffect(() => {
    return registerSignOutCleanup(async () => {
      wipedRef.current = true;
      genRef.current += 1;
      try {
        await clearTaskCache(asyncStorageStore);
      } catch {
        // Best effort.
      }
      resetMemory();
    });
  }, [registerSignOutCleanup, resetMemory]);

  // Forget the lists of projects that are no longer in the project list. Only once the project
  // list itself has been confirmed by the server, so a cached or empty list never prunes anything.
  useEffect(() => {
    if (!ready || projectsStatus !== "ready") return;
    const current = cacheRef.current;
    const pruned = pruneTaskCache(
      current,
      projects.map((p) => p.id),
    );
    const same =
      Object.keys(pruned.byProject).length === Object.keys(current.byProject).length &&
      Object.keys(pruned.filters).length === Object.keys(current.filters).length;
    if (!same) void publish(pruned);
  }, [ready, projectsStatus, projects, publish]);

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

  const me = useMemo<TaskAssignee | null>(
    () => (userId && displayName !== null ? { id: userId, displayName } : null),
    [userId, displayName],
  );

  /**
   * The people a change can name: me, assignees on cached tasks, the `members` prop, and the
   * project's members from the members cache (#5's, refreshed by useMembers; never another
   * person's). Read when a change is made, so it is as fresh as the last member refresh.
   */
  const peopleFor = useCallback(
    async (projectId: string, owner: string): Promise<TaskAssignee[]> => {
      let saved: TaskAssignee[] = [];
      try {
        saved = membersToAssignees((await loadMembers(asyncStorageStore, owner, projectId)) ?? []);
      } catch {
        // Unreadable: names come from what the phone already knows.
      }
      return deriveMembers(me, cacheRef.current.byProject[projectId] ?? [], [
        ...saved,
        ...(membersRef.current?.(projectId) ?? []),
      ]);
    },
    [me],
  );

  const create = useCallback<TasksContextValue["create"]>(
    async (projectId, input) => {
      const owner = loadedOwnerRef.current;
      if (!readyRef.current || !owner) return { ok: false, errors: {} };
      const people = await peopleFor(projectId, owner);
      const now = new Date();
      const id = newId();
      const plan = planTaskCreate({ id, projectId, userId: owner, input, members: people, now });
      if (!plan.ok) return plan;
      await track(async () => {
        await queue.enqueue(plan.change);
        const list = cacheRef.current.byProject[projectId] ?? [];
        void commit(projectId, showLocalChange(list, projectId, plan.change, now));
      });
      await afterEnqueue();
      return { ok: true, id };
    },
    [track, commit, queue, afterEnqueue, peopleFor],
  );

  const update = useCallback<TasksContextValue["update"]>(
    async (projectId, taskId, edit) => {
      const owner = loadedOwnerRef.current;
      if (!readyRef.current || !owner) return { ok: false, errors: {} };
      const current = (cacheRef.current.byProject[projectId] ?? []).find((t) => t.id === taskId);
      if (!current) return { ok: true };
      const people = await peopleFor(projectId, owner);
      const now = new Date();
      const plan = planTaskUpdate(current, edit, people, now);
      if (!plan.ok) return plan;
      const change = plan.change;
      if (!change) return { ok: true };
      await track(async () => {
        await queue.enqueue(change);
        const list = cacheRef.current.byProject[projectId] ?? [];
        void commit(projectId, showLocalChange(list, projectId, change, now));
      });
      await afterEnqueue();
      return { ok: true };
    },
    [track, commit, queue, afterEnqueue, peopleFor],
  );

  const setStatus = useCallback<TasksContextValue["setStatus"]>(
    (projectId, taskId, status) => update(projectId, taskId, { status }),
    [update],
  );

  const remove = useCallback<TasksContextValue["remove"]>(
    async (projectId, taskId) => {
      const task = (cacheRef.current.byProject[projectId] ?? []).find((t) => t.id === taskId);
      if (!readyRef.current || !task) return;
      const change = planTaskDelete(task);
      await track(async () => {
        await queue.enqueue(change);
        const list = cacheRef.current.byProject[projectId] ?? [];
        void commit(projectId, showLocalChange(list, projectId, change, new Date()));
      });
      await afterEnqueue();
    },
    [track, commit, queue, afterEnqueue],
  );

  const refresh = useCallback<TasksContextValue["refresh"]>(
    async (projectId) => {
      if (!readyRef.current) return "skipped";
      return runExclusive(async () => {
        await cycle.idle();
        return cycle.refresh(projectId);
      });
    },
    [runExclusive, cycle],
  );

  const setFilters = useCallback(
    async (projectId: string, filters: TaskFilters) => {
      if (!readyRef.current) return;
      await publish(setProjectFilters(cacheRef.current, projectId, filters));
    },
    [publish],
  );

  const dismissRejectedNotice = useCallback(() => setRejectedNotice(null), []);

  const tasksFor = useCallback((projectId: string) => cache.byProject[projectId] ?? [], [cache]);
  const filtersFor = useCallback((projectId: string) => cache.filters[projectId] ?? DEFAULT_FILTERS, [cache]);

  const value = useMemo<TasksContextValue>(
    () => ({
      ready,
      tasksFor,
      filtersFor,
      setFilters,
      create,
      update,
      setStatus,
      remove,
      refresh,
      rejectedNotice,
      dismissRejectedNotice,
    }),
    [ready, tasksFor, filtersFor, setFilters, create, update, setStatus, remove, refresh, rejectedNotice, dismissRejectedNotice],
  );

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}
