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
import type { NewChange } from "../sync/queue";
import { asyncStorageStore } from "../sync/asyncStorageStore";
import { loadMembers } from "../members/memberCache";
import type { LabelColour } from "../theme/tokens";
import { listLabels, listTasks } from "./api";
import { membersToAssignees } from "./assignees";
import { DEFAULT_FILTERS, type TaskFilters } from "./filters";
import { deriveMembers, showLocalChange, showLocalLabelChange } from "./localChange";
import {
  planChecklistCreate,
  planChecklistDelete,
  planChecklistRename,
  planItemCreate,
  planItemDelete,
  planItemEdit,
  planLabelCreate,
  planLabelDelete,
  planLabelUpdate,
  planSetTaskLabels,
  planTaskCreate,
  planTaskDelete,
  planTaskUpdate,
  type TaskEdit,
} from "./optimistic";
import type { TaskRejectedNotice } from "./outcomes";
import {
  clearTaskCache,
  emptyTaskCache,
  openTaskCache,
  pruneTaskCache,
  saveTaskCache,
  labelsFor as cachedLabelsFor,
  setProjectFilters,
  setProjectLabels,
  setProjectTasks,
  type TaskCache,
} from "./store";
import { clearCommentCache, pruneCommentCache, updateCommentCache } from "./comments/store";
import { registerCommentEntity } from "./comments/sync";
import { clearPhotoCache, prunePhotoCache, updatePhotoCache } from "./photos/store";
import { clearPendingFiles, photoDeps } from "./photos/realDeps";
import { registerPhotoEntities } from "./photos/uploads";
import { ITEM_ENTITY, TASK_LABELS_ENTITY, registerChecklistEntities, registerTaskEntity } from "./sync";
import { createTaskSyncCycle, type RefreshResult } from "./syncCycle";
import type { Label, Task, TaskAssignee, TaskStatus } from "./types";
import type { TaskInput, TaskInputErrors } from "./validate";
import { queueLabelDelete, queueTaskLabels } from "./waitingLabels";

export type { TaskRejectedNotice } from "./outcomes";
export type { TaskFilters } from "./filters";
export type { TaskEdit } from "./optimistic";
export type { RefreshResult } from "./syncCycle";

/**
 * `errors` is the same shape as validateTaskInput. It is empty when the provider is not `ready`
 * (nobody to attribute the change to yet); screens only offer forms once `ready` is true.
 */
export type TaskMutationResult<T = object> = ({ ok: true } & T) | { ok: false; errors: TaskInputErrors };

/**
 * What a label, checklist or item action answers. `error` is an i18n key (a tasks.errors.* message)
 * when the phone refused the change before recording it: a bad name, a duplicate label name, a limit.
 */
export type ChecklistMutationResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const findTask = (cache: TaskCache, projectId: string, taskId: string): Task | undefined =>
  (cache.byProject[projectId] ?? []).find((t) => t.id === taskId);

type TasksContextValue = {
  /** True once the local copy for the signed-in person is loaded. Mutations and refresh wait for it. */
  ready: boolean;
  /** The cached list for a project, in server order then offline-created order. Not sorted or filtered. */
  tasksFor: (projectId: string) => Task[];
  filtersFor: (projectId: string) => TaskFilters;
  /** The project's labels, in server order then offline-created order. */
  labelsFor: (projectId: string) => Label[];
  createLabel: (projectId: string, name: string, colour: LabelColour) => Promise<ChecklistMutationResult<{ id: string }>>;
  updateLabel: (
    projectId: string,
    labelId: string,
    edit: { name?: string; colour?: LabelColour },
  ) => Promise<ChecklistMutationResult>;
  /** Takes the label off every task here and drops it; waiting task-label changes lose it too. */
  deleteLabel: (projectId: string, labelId: string) => Promise<void>;
  /** The whole set of label ids on the task. */
  setTaskLabels: (projectId: string, taskId: string, labelIds: string[]) => Promise<ChecklistMutationResult>;
  addChecklist: (projectId: string, taskId: string, name: string) => Promise<ChecklistMutationResult<{ id: string }>>;
  renameChecklist: (projectId: string, taskId: string, checklistId: string, name: string) => Promise<ChecklistMutationResult>;
  /** Also drops the waiting changes of the checklist items. */
  deleteChecklist: (projectId: string, taskId: string, checklistId: string) => Promise<void>;
  addItem: (
    projectId: string,
    taskId: string,
    checklistId: string,
    text: string,
  ) => Promise<ChecklistMutationResult<{ id: string }>>;
  editItem: (
    projectId: string,
    taskId: string,
    checklistId: string,
    itemId: string,
    text: string,
  ) => Promise<ChecklistMutationResult>;
  /** `done` omitted flips the item. Sends only `done`. */
  toggleItem: (
    projectId: string,
    taskId: string,
    checklistId: string,
    itemId: string,
    done?: boolean,
  ) => Promise<ChecklistMutationResult>;
  deleteItem: (projectId: string, taskId: string, checklistId: string, itemId: string) => Promise<void>;
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
  // The saved name counts while the profile has not answered, so "me" is always known to a change.
  const meId = auth.identity?.id ?? null;
  const displayName = auth.identity?.displayName ?? null;
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

  const commitLabels = useCallback(
    (projectId: string, labels: Label[]) => publish(setProjectLabels(cacheRef.current, projectId, labels)),
    [publish],
  );

  const [cycle] = useState(() => {
    const c = createTaskSyncCycle({
      getQueue: () => queue,
      getToken,
      listTasks,
      listLabels,
      getTasks: (projectId) => cacheRef.current.byProject[projectId] ?? [],
      getLabels: (projectId) => cachedLabelsFor(cacheRef.current, projectId),
      commit,
      commitLabels,
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
    registerChecklistEntities(queue, c.handlers);
    // Comments keep their own refusals (retry or discard per comment), not the task-wide notice.
    registerCommentEntity(queue, asyncStorageStore);
    // Photos too: an upload that is refused for good stays on its thumbnail to retry or discard.
    registerPhotoEntities(queue, asyncStorageStore, photoDeps);
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
        await cycle.refreshPending();
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
        await clearCommentCache(asyncStorageStore);
        await clearPhotoCache(asyncStorageStore);
        // Pictures waiting to upload belong to the person who took them.
        clearPendingFiles();
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
      Object.keys(pruned.labelsByProject).length === Object.keys(current.labelsByProject).length &&
      Object.keys(pruned.filters).length === Object.keys(current.filters).length;
    if (!same) void publish(pruned);
    // The comments and photos of those projects go too.
    const owner = loadedOwnerRef.current;
    if (owner) {
      const ids = projects.map((p) => p.id);
      void updateCommentCache(asyncStorageStore, owner, (c) => pruneCommentCache(c, ids)).catch(() => {});
      void updatePhotoCache(asyncStorageStore, owner, (c) => prunePhotoCache(c, ids)).catch(() => {});
    }
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
    () => (meId && displayName !== null ? { id: meId, displayName } : null),
    [meId, displayName],
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
        await queue.dropEntity(TASK_LABELS_ENTITY, taskId); // a label set for a task that is going away has nowhere to go
        await queue.enqueue(change);
        const list = cacheRef.current.byProject[projectId] ?? [];
        void commit(projectId, showLocalChange(list, projectId, change, new Date()));
      });
      await afterEnqueue();
    },
    [track, commit, queue, afterEnqueue],
  );

  /** Records a task, checklist or item change: queue it, show it at once, then ask for a send. */
  const recordTaskChange = useCallback(
    async (projectId: string, change: NewChange) => {
      const now = new Date();
      await track(async () => {
        await queue.enqueue(change);
        void commit(projectId, showLocalChange(cacheRef.current.byProject[projectId] ?? [], projectId, change, now));
      });
      await afterEnqueue();
    },
    [track, commit, queue, afterEnqueue],
  );

  const createLabel = useCallback<TasksContextValue["createLabel"]>(
    async (projectId, name, colour) => {
      if (!readyRef.current) return { ok: false, error: "tasks.reasons.generic" };
      const now = new Date();
      const id = newId();
      const plan = planLabelCreate({ id, projectId, name, colour, labels: cachedLabelsFor(cacheRef.current, projectId), now });
      if (!plan.ok) return plan;
      const change = plan.change;
      if (!change) return { ok: true, id };
      await track(async () => {
        await queue.enqueue(change);
        void commitLabels(projectId, showLocalLabelChange(cachedLabelsFor(cacheRef.current, projectId), projectId, change, now));
      });
      await afterEnqueue();
      return { ok: true, id };
    },
    [track, commitLabels, queue, afterEnqueue],
  );

  const updateLabel = useCallback<TasksContextValue["updateLabel"]>(
    async (projectId, labelId, edit) => {
      if (!readyRef.current) return { ok: false, error: "tasks.reasons.generic" };
      const labels = cachedLabelsFor(cacheRef.current, projectId);
      const current = labels.find((l) => l.id === labelId);
      if (!current) return { ok: true };
      const now = new Date();
      const plan = planLabelUpdate(current, projectId, edit, labels, now);
      if (!plan.ok) return plan;
      const change = plan.change;
      if (!change) return { ok: true };
      await track(async () => {
        await queue.enqueue(change);
        void commitLabels(projectId, showLocalLabelChange(cachedLabelsFor(cacheRef.current, projectId), projectId, change, now));
      });
      await afterEnqueue();
      return { ok: true };
    },
    [track, commitLabels, queue, afterEnqueue],
  );

  const deleteLabel = useCallback<TasksContextValue["deleteLabel"]>(
    async (projectId, labelId) => {
      const label = cachedLabelsFor(cacheRef.current, projectId).find((l) => l.id === labelId);
      if (!readyRef.current || !label) return;
      const change = planLabelDelete(label, projectId);
      const now = new Date();
      await track(async () => {
        await queueLabelDelete(queue, change, now);
        void commitLabels(projectId, showLocalLabelChange(cachedLabelsFor(cacheRef.current, projectId), projectId, change, now));
        // The label delete laid over the tasks takes the label off the local task copies.
        void commit(projectId, showLocalChange(cacheRef.current.byProject[projectId] ?? [], projectId, change, now));
      });
      await afterEnqueue();
    },
    [track, commit, commitLabels, queue, afterEnqueue],
  );

  const setTaskLabels = useCallback<TasksContextValue["setTaskLabels"]>(
    async (projectId, taskId, labelIds) => {
      if (!readyRef.current) return { ok: false, error: "tasks.reasons.generic" };
      const task = findTask(cacheRef.current, projectId, taskId);
      if (!task) return { ok: true };
      const now = new Date();
      const plan = planSetTaskLabels(task, labelIds, cachedLabelsFor(cacheRef.current, projectId), now);
      if (!plan.ok) return plan;
      const change = plan.change;
      if (!change) return { ok: true };
      await track(async () => {
        // The task's labels are their own change; it is kept behind any label create it uses.
        await queueTaskLabels(queue, change);
        void commit(projectId, showLocalChange(cacheRef.current.byProject[projectId] ?? [], projectId, change, now));
      });
      await afterEnqueue();
      return { ok: true };
    },
    [track, commit, queue, afterEnqueue],
  );

  const addChecklist = useCallback<TasksContextValue["addChecklist"]>(
    async (projectId, taskId, name) => {
      if (!readyRef.current) return { ok: false, error: "tasks.reasons.generic" };
      const task = findTask(cacheRef.current, projectId, taskId);
      if (!task) return { ok: false, error: "tasks.reasons.notFound" };
      const id = newId();
      const plan = planChecklistCreate({ id, task, name, now: new Date() });
      if (!plan.ok) return plan;
      if (plan.change) await recordTaskChange(projectId, plan.change);
      return { ok: true, id };
    },
    [recordTaskChange],
  );

  const renameChecklist = useCallback<TasksContextValue["renameChecklist"]>(
    async (projectId, taskId, checklistId, name) => {
      if (!readyRef.current) return { ok: false, error: "tasks.reasons.generic" };
      const task = findTask(cacheRef.current, projectId, taskId);
      const checklist = task?.checklists.find((c) => c.id === checklistId);
      if (!task || !checklist) return { ok: true };
      const plan = planChecklistRename(task, checklist, name, new Date());
      if (!plan.ok) return plan;
      if (plan.change) await recordTaskChange(projectId, plan.change);
      return { ok: true };
    },
    [recordTaskChange],
  );

  const deleteChecklist = useCallback<TasksContextValue["deleteChecklist"]>(
    async (projectId, taskId, checklistId) => {
      const task = findTask(cacheRef.current, projectId, taskId);
      const checklist = task?.checklists.find((c) => c.id === checklistId);
      if (!readyRef.current || !task || !checklist) return;
      const change = planChecklistDelete(task, checklist);
      const now = new Date();
      await track(async () => {
        // Items of a checklist that is going away must not be sent: the server would refuse them.
        const itemIds = new Set(checklist.items.map((i) => i.id));
        for (const waiting of await queue.waiting()) {
          if (waiting.entity === ITEM_ENTITY && waiting.data.checklistId === checklistId) itemIds.add(waiting.entityId);
        }
        for (const itemId of itemIds) await queue.dropEntity(ITEM_ENTITY, itemId);
        await queue.enqueue(change);
        void commit(projectId, showLocalChange(cacheRef.current.byProject[projectId] ?? [], projectId, change, now));
      });
      await afterEnqueue();
    },
    [track, commit, queue, afterEnqueue],
  );

  const addItem = useCallback<TasksContextValue["addItem"]>(
    async (projectId, taskId, checklistId, text) => {
      if (!readyRef.current) return { ok: false, error: "tasks.reasons.generic" };
      const task = findTask(cacheRef.current, projectId, taskId);
      const checklist = task?.checklists.find((c) => c.id === checklistId);
      if (!task || !checklist) return { ok: false, error: "tasks.reasons.checklistNotFound" };
      const id = newId();
      const plan = planItemCreate({ id, task, checklist, text, now: new Date() });
      if (!plan.ok) return plan;
      if (plan.change) await recordTaskChange(projectId, plan.change);
      return { ok: true, id };
    },
    [recordTaskChange],
  );

  const editItemFields = useCallback(
    async (
      projectId: string,
      taskId: string,
      checklistId: string,
      itemId: string,
      edit: { text?: string; done?: boolean },
    ): Promise<ChecklistMutationResult> => {
      if (!readyRef.current) return { ok: false, error: "tasks.reasons.generic" };
      const task = findTask(cacheRef.current, projectId, taskId);
      const checklist = task?.checklists.find((c) => c.id === checklistId);
      const item = checklist?.items.find((i) => i.id === itemId);
      if (!task || !checklist || !item) return { ok: true };
      const plan = planItemEdit(task, checklist, item, edit, new Date());
      if (!plan.ok) return plan;
      if (plan.change) await recordTaskChange(projectId, plan.change);
      return { ok: true };
    },
    [recordTaskChange],
  );

  const editItem = useCallback<TasksContextValue["editItem"]>(
    (projectId, taskId, checklistId, itemId, text) => editItemFields(projectId, taskId, checklistId, itemId, { text }),
    [editItemFields],
  );

  const toggleItem = useCallback<TasksContextValue["toggleItem"]>(
    (projectId, taskId, checklistId, itemId, done) => {
      const current = findTask(cacheRef.current, projectId, taskId)
        ?.checklists.find((c) => c.id === checklistId)
        ?.items.find((i) => i.id === itemId);
      return editItemFields(projectId, taskId, checklistId, itemId, { done: done ?? !current?.done });
    },
    [editItemFields],
  );

  const deleteItem = useCallback<TasksContextValue["deleteItem"]>(
    async (projectId, taskId, checklistId, itemId) => {
      const task = findTask(cacheRef.current, projectId, taskId);
      const checklist = task?.checklists.find((c) => c.id === checklistId);
      const item = checklist?.items.find((i) => i.id === itemId);
      if (!readyRef.current || !task || !checklist || !item) return;
      await recordTaskChange(projectId, planItemDelete(task, checklist, item));
    },
    [recordTaskChange],
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
  const labelsFor = useCallback((projectId: string) => cachedLabelsFor(cache, projectId), [cache]);

  const value = useMemo<TasksContextValue>(
    () => ({
      ready,
      tasksFor,
      filtersFor,
      labelsFor,
      createLabel,
      updateLabel,
      deleteLabel,
      setTaskLabels,
      addChecklist,
      renameChecklist,
      deleteChecklist,
      addItem,
      editItem,
      toggleItem,
      deleteItem,
      setFilters,
      create,
      update,
      setStatus,
      remove,
      refresh,
      rejectedNotice,
      dismissRejectedNotice,
    }),
    [
      ready,
      tasksFor,
      filtersFor,
      labelsFor,
      createLabel,
      updateLabel,
      deleteLabel,
      setTaskLabels,
      addChecklist,
      renameChecklist,
      deleteChecklist,
      addItem,
      editItem,
      toggleItem,
      deleteItem,
      setFilters,
      create,
      update,
      setStatus,
      remove,
      refresh,
      rejectedNotice,
      dismissRejectedNotice,
    ],
  );

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}
