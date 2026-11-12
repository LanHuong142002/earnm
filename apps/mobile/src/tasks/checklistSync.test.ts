import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { createQueue, type NewChange, type Queue } from "../sync/queue";
import { createMemoryStore } from "../sync/storage";
import { makeTask } from "./fixtures";
import { noticeKeys, reasonFor, type TaskRejectedNotice } from "./outcomes";
import {
  planChecklistCreate,
  planItemEdit,
  planLabelCreate,
  planLabelUpdate,
  planSetTaskLabels,
} from "./optimistic";
import { CHECKLIST_ENTITY, ITEM_ENTITY, LABEL_ENTITY, registerChecklistEntities, registerTaskEntity } from "./sync";
import { createTaskSyncCycle } from "./syncCycle";
import type { Checklist, Label, Task } from "./types";
import { stripLabelFromWaiting, taskChangesToResend } from "./waitingLabels";

const USER = "user-1";
const NOW = new Date("2026-11-12T09:00:00.000Z");
const LATER = new Date("2026-11-12T09:05:00.000Z");

const checklist = (over: Partial<Checklist> = {}): Checklist => ({
  id: "c1",
  name: "Shopping",
  createdAt: "2026-11-01T00:00:00.000Z",
  items: [{ id: "i1", text: "Paint", done: false, createdAt: "2026-11-01T00:00:00.000Z" }],
  ...over,
});

type Throwing = (() => Promise<unknown>) | undefined;

/** A queue with fake senders (nothing leaves the process) and the real cycle on top. */
function setup(initial: { tasks?: Task[]; labels?: Label[] } = {}, behave: Record<string, Throwing> = {}) {
  const state = { tasks: initial.tasks ?? [], labels: initial.labels ?? [] };
  let notice: TaskRejectedNotice | null = null;
  const calls: { name: string; args: unknown[] }[] = [];
  const fake = (name: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push({ name, args: args.slice(1) });
      const custom = behave[name];
      if (custom) return custom();
      throw new ApiError("network"); // never a real request
    });
  const deps = {
    createLabel: fake("createLabel"),
    patchLabel: fake("patchLabel"),
    deleteLabel: fake("deleteLabel"),
    createChecklist: fake("createChecklist"),
    patchChecklist: fake("patchChecklist"),
    deleteChecklist: fake("deleteChecklist"),
    createChecklistItem: fake("createChecklistItem"),
    patchChecklistItem: fake("patchChecklistItem"),
    deleteChecklistItem: fake("deleteChecklistItem"),
  };
  const taskDeps = { createTask: fake("createTask"), patchTask: fake("patchTask"), deleteTask: fake("deleteTask") };
  let queue!: Queue;
  const cycle = createTaskSyncCycle({
    getQueue: () => queue,
    getToken: async () => "tok",
    // What the server holds stays what the test started with; `state` is the phone's copy.
    listTasks: async () => initial.tasks ?? [],
    listLabels: async () => initial.labels ?? [],
    getTasks: () => state.tasks,
    getLabels: () => state.labels,
    commit: async (_p, list) => {
      state.tasks = list;
    },
    commitLabels: async (_p, labels) => {
      state.labels = labels;
    },
    setNotice: (n) => {
      notice = n;
    },
    getGeneration: () => 0,
    isWiped: () => false,
    settleMutations: async () => queue.waiting(),
    onNotSignedIn: vi.fn(),
  });
  queue = createQueue({
    store: createMemoryStore(),
    getToken: async () => "tok",
    onApplied: vi.fn(),
    onRejected: vi.fn(),
    onSignedOut: vi.fn(),
  });
  registerTaskEntity(queue, cycle.handlers, taskDeps as never);
  registerChecklistEntities(queue, cycle.handlers, deps as never);
  return {
    queue,
    cycle,
    state,
    calls,
    deps,
    taskDeps,
    get notice() {
      return notice;
    },
    enqueue: async (change: NewChange) => {
      await queue.setOwner(USER);
      return queue.enqueue(change);
    },
    flush: async () => {
      await queue.flush(USER);
      await cycle.idle();
    },
  };
}

const itemChange = (kind: NewChange["kind"], data: Record<string, unknown> = {}): NewChange => ({
  entity: ITEM_ENTITY,
  entityId: "i1",
  kind,
  data: { projectId: "p1", taskId: "t1", checklistId: "c1", ...data },
});

describe("merging in the shared queue (AC14)", () => {
  it("two ticks of the same item leave one waiting change, the later value", async () => {
    const h = setup();
    await h.enqueue({ ...itemChange("update", { done: true }), fieldTimes: { done: "2026-11-12T09:00:00.000Z" } });
    await h.enqueue({ ...itemChange("update", { done: false }), fieldTimes: { done: "2026-11-12T09:00:05.000Z" } });
    const waiting = await h.queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data.done).toBe(false);
  });

  it("creating then renaming a checklist leaves one create with the new name", async () => {
    const h = setup();
    await h.enqueue({ entity: CHECKLIST_ENTITY, entityId: "c9", kind: "create", data: { projectId: "p1", taskId: "t1", name: "Old" } });
    await h.enqueue({ entity: CHECKLIST_ENTITY, entityId: "c9", kind: "update", data: { projectId: "p1", taskId: "t1", name: "New" } });
    const waiting = await h.queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ kind: "create", data: { name: "New" } });
  });

  it("creating then deleting an item sends nothing", async () => {
    const h = setup();
    await h.enqueue(itemChange("create", { text: "x", done: false }));
    await h.enqueue(itemChange("delete"));
    expect(await h.queue.count()).toBe(0);
    await h.flush();
    expect(h.calls).toEqual([]);
  });

  it("an item ticked while its create waits is created and then ticked", async () => {
    const h = setup({}, { createChecklistItem: async () => ({ id: "i1" }), patchChecklistItem: async () => ({ id: "i1", done: true }) });
    await h.enqueue(itemChange("create", { text: "x", done: false }));
    await h.enqueue(itemChange("update", { done: true }));
    expect(await h.queue.count()).toBe(1);
    await h.flush();
    expect(h.calls.map((c) => c.name)).toEqual(["createChecklistItem", "patchChecklistItem"]);
  });

  it("ticking an existing item sends only done", async () => {
    const h = setup({}, { patchChecklistItem: async () => ({ id: "i1", text: "Paint", done: true }) });
    const plan = planItemEdit(makeTask({ checklists: [checklist()] }), checklist(), checklist().items[0], { done: true }, NOW);
    expect(plan.ok && plan.change).toBeTruthy();
    await h.enqueue((plan as { change: NewChange }).change);
    await h.flush();
    const fields = h.calls[0].args[4] as Record<string, unknown>;
    expect(Object.keys(fields)).toEqual(["done"]);
  });

  it("a task label change created offline is sent after its create", async () => {
    const h = setup({}, { createTask: async () => ({}), patchTask: async () => ({}) });
    await h.enqueue({ entity: "task", entityId: "t5", kind: "create", data: { projectId: "p1", title: "New" } });
    await h.enqueue({ entity: "task", entityId: "t5", kind: "update", data: { projectId: "p1", labels: ["a"] } });
    expect(await h.queue.count()).toBe(1);
    await h.flush();
    expect(h.calls.map((c) => c.name)).toEqual(["createTask", "patchTask"]);
  });
});

describe("a refused checklist or item change (AC15)", () => {
  const task = makeTask({ checklists: [checklist()] });

  it("puts back the server version and says it could not be saved", async () => {
    const h = setup({ tasks: [task] }, { patchChecklistItem: async () => Promise.reject(new ApiError("forbidden", 403)) });
    await h.enqueue({ ...itemChange("update", { done: true }) });
    // The phone showed the tick at once.
    h.state.tasks = [makeTask({ checklists: [checklist({ items: [{ ...checklist().items[0], done: true }] })] })];
    await h.flush();
    expect(h.notice).toMatchObject({ kind: "update", subject: "item", reason: "forbidden" });
    expect(noticeKeys(h.notice!).headline).toBe("tasks.rejectedItem");
    await h.cycle.refreshPending();
    expect(h.state.tasks[0].checklists[0].items[0].done).toBe(false);
    expect(await h.queue.count()).toBe(0);
  });

  it("removes the item on 404 and names it as gone", async () => {
    const h = setup({ tasks: [task] }, { patchChecklistItem: async () => Promise.reject(new ApiError("not_found", 404)) });
    await h.enqueue({ ...itemChange("update", { text: "x" }) });
    await h.flush();
    expect(h.state.tasks[0].checklists[0].items).toEqual([]);
    expect(noticeKeys(h.notice!).reason).toBe("tasks.reasons.itemNotFound");
  });

  it("removes a checklist on 404", async () => {
    const h = setup({ tasks: [task] }, { patchChecklist: async () => Promise.reject(new ApiError("not_found", 404)) });
    await h.enqueue({ entity: CHECKLIST_ENTITY, entityId: "c1", kind: "update", data: { projectId: "p1", taskId: "t1", name: "x" } });
    await h.flush();
    expect(h.state.tasks[0].checklists).toEqual([]);
    expect(noticeKeys(h.notice!).reason).toBe("tasks.reasons.checklistNotFound");
  });

  it("a refused item create over the limit leaves the local copy", async () => {
    const h = setup(
      { tasks: [makeTask({ checklists: [checklist({ items: [{ id: "i2", text: "x", done: false, createdAt: "2026-11-01T00:00:00.000Z" }] })] })] },
      { createChecklistItem: async () => Promise.reject(new ApiError("item_limit_reached", 409)) },
    );
    await h.enqueue({ ...itemChange("create", { text: "x", done: false }), entityId: "i2" });
    await h.flush();
    expect(h.state.tasks[0].checklists[0].items).toEqual([]);
    expect(h.notice?.reason).toBe("itemLimit");
    expect(noticeKeys(h.notice!).reason).toBe("tasks.reasons.itemLimit");
  });

  it("maps the new error codes to reasons", () => {
    expect(reasonFor(new ApiError("label_name_taken", 409))).toBe("labelNameTaken");
    expect(reasonFor(new ApiError("label_limit_reached", 409))).toBe("labelLimit");
    expect(reasonFor(new ApiError("checklist_limit_reached", 409))).toBe("checklistLimit");
    expect(reasonFor(new ApiError("item_limit_reached", 409))).toBe("itemLimit");
  });

  it("a refused label delete by a Member says only an Owner can", () => {
    const keys = noticeKeys({ kind: "delete", taskTitle: null, reason: "forbidden", subject: "label" });
    expect(keys.reason).toBe("tasks.reasons.labelForbiddenDelete");
  });
});

describe("a label the server refuses (AC15)", () => {
  const labels: Label[] = [{ id: "dup", projectId: "p1", name: "Urgent", colour: "red" }];

  it("a duplicate is removed from the label list and from the task it was put on", async () => {
    const h = setup(
      { tasks: [makeTask({ labelIds: ["dup", "ok"] })], labels },
      { createLabel: async () => Promise.reject(new ApiError("label_name_taken", 409)) },
    );
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "dup", kind: "create", data: { projectId: "p1", name: "Urgent", colour: "red" } });
    await h.flush();
    expect(h.state.labels).toEqual([]);
    expect(h.state.tasks[0].labelIds).toEqual(["ok"]);
    expect(h.notice).toMatchObject({ subject: "label", reason: "labelNameTaken" });
  });

  it("a duplicate is stripped from waiting task-label changes, which keep their other labels", async () => {
    const h = setup(
      { tasks: [makeTask({ labelIds: ["dup", "ok"] })], labels },
      { createLabel: async () => Promise.reject(new ApiError("label_name_taken", 409)) },
    );
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "dup", kind: "create", data: { projectId: "p1", name: "Urgent", colour: "red" } });
    await h.queue.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", labels: ["dup", "ok"] } });
    // Send the label create only; the task change stays waiting behind it.
    await h.queue.flush(USER);
    await h.cycle.idle();
    const waiting = await h.queue.waiting();
    expect(waiting.filter((c) => c.entity === "task")).toHaveLength(1);
    expect(waiting.find((c) => c.entity === "task")?.data.labels).toEqual(["ok"]);
    expect(await h.queue.waiting().then((w) => w.some((c) => c.entity === LABEL_ENTITY))).toBe(false);
  });

  it("a refresh loads the project labels and keeps a waiting label create", async () => {
    const h = setup({ labels: [{ id: "a", name: "Urgent", colour: "red" }] });
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "b", kind: "create", data: { projectId: "p1", name: "Later", colour: "blue" } });
    expect(await h.cycle.refresh("p1")).toBe("ok");
    expect(h.state.labels.map((l) => l.name)).toEqual(["Urgent", "Later"]);
  });
});

describe("waiting label helpers", () => {
  it("stripLabelFromWaiting re-enqueues a waiting task-label change without the label, with a fresh time", async () => {
    const h = setup();
    await h.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", labels: ["a", "b"] }, fieldTimes: { labels: NOW.toISOString(), projectId: NOW.toISOString() } });
    await stripLabelFromWaiting(h.queue, "p1", "a", LATER);
    const waiting = await h.queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data.labels).toEqual(["b"]);
    expect(waiting[0].fieldTimes.labels).toBe(LATER.toISOString());
  });

  it("taskChangesToResend asks to move a task change that waits ahead of a label create it now uses", async () => {
    const h = setup();
    await h.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", title: "x" } });
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "n", kind: "create", data: { projectId: "p1", name: "N", colour: "red" } });
    const waiting = await h.queue.waiting();
    expect(taskChangesToResend(waiting, "t1", ["n"])).toHaveLength(1);
    expect(taskChangesToResend(waiting, "t1", ["other"])).toBeNull();
    expect(taskChangesToResend(waiting, "t2", ["n"])).toBeNull();
  });
});

describe("deleting a checklist drops its items waiting changes", () => {
  it("dropEntity per item leaves only the checklist delete", async () => {
    const h = setup();
    await h.enqueue(itemChange("update", { done: true }));
    await h.enqueue({ ...itemChange("update", { text: "x" }), entityId: "i2" });
    for (const id of ["i1", "i2"]) await h.queue.dropEntity(ITEM_ENTITY, id);
    await h.queue.enqueue({ entity: CHECKLIST_ENTITY, entityId: "c1", kind: "delete", data: { projectId: "p1", taskId: "t1" } });
    const waiting = await h.queue.waiting();
    expect(waiting.map((c) => c.entity)).toEqual([CHECKLIST_ENTITY]);
  });
});

describe("plans", () => {
  const task = makeTask({ checklists: [checklist()] });
  const labels: Label[] = [{ id: "a", name: "Urgent", colour: "red" }];

  it("refuses a duplicate label name (any case or accents form) and the limits, with a message key", () => {
    const dup = planLabelCreate({ id: "x", projectId: "p1", name: " URGENT ", colour: "blue", labels, now: NOW });
    expect(dup).toEqual({ ok: false, error: "tasks.errors.labelNameDuplicate" });
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, colour: "gray" as const }));
    expect(planLabelCreate({ id: "x", projectId: "p1", name: "New", colour: "blue", labels: many, now: NOW })).toEqual({
      ok: false,
      error: "tasks.errors.labelLimit",
    });
  });

  it("a label rename sends only the name, each field with its own time", () => {
    const plan = planLabelUpdate(labels[0], "p1", { name: "Now", colour: "red" }, labels, NOW);
    expect(plan.ok && plan.change?.data).toEqual({ projectId: "p1", name: "Now" });
  });

  it("limits checklists per task and labels per task", () => {
    const full = makeTask({ checklists: Array.from({ length: 10 }, (_, i) => checklist({ id: `c${i}` })) });
    expect(planChecklistCreate({ id: "n", task: full, name: "x", now: NOW })).toEqual({ ok: false, error: "tasks.errors.checklistLimit" });
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, colour: "gray" as const }));
    expect(planSetTaskLabels(task, many.map((l) => l.id), many, NOW)).toEqual({ ok: false, error: "tasks.errors.labelsPerTaskLimit" });
  });

  it("setting the same labels changes nothing", () => {
    const tagged = makeTask({ labelIds: ["a"] });
    expect(planSetTaskLabels(tagged, ["a"], labels, NOW)).toEqual({ ok: true, change: null });
  });
});
