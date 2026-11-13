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
import { CHECKLIST_ENTITY, ITEM_ENTITY, LABEL_ENTITY, TASK_LABELS_ENTITY, registerChecklistEntities, registerTaskEntity } from "./sync";
import { createTaskSyncCycle } from "./syncCycle";
import type { Checklist, Label, Task } from "./types";
import { queueLabelDelete, queueTaskLabels, stripLabelFromWaiting } from "./waitingLabels";

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

type Throwing = ((...args: unknown[]) => Promise<unknown>) | undefined;

/** A queue with fake senders (nothing leaves the process) and the real cycle on top. */
function setup(initial: { tasks?: Task[]; labels?: Label[] } = {}, behave: Record<string, Throwing> = {}) {
  const state = { tasks: initial.tasks ?? [], labels: initial.labels ?? [] };
  let notice: TaskRejectedNotice | null = null;
  const calls: { name: string; args: unknown[] }[] = [];
  const fake = (name: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push({ name, args: args.slice(1) });
      const custom = behave[name];
      if (custom) return custom(...args.slice(1));
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

  it("a task's labels are their own change: not folded into the task create, sent after it", async () => {
    const h = setup({}, { createTask: async () => ({}), patchTask: async () => ({}) });
    await h.enqueue({ entity: "task", entityId: "t5", kind: "create", data: { projectId: "p1", title: "New" } });
    await h.enqueue({ entity: TASK_LABELS_ENTITY, entityId: "t5", kind: "update", data: { projectId: "p1", labels: ["a"] } });
    const waiting = await h.queue.waiting();
    expect(waiting.map((c) => c.entity)).toEqual(["task", TASK_LABELS_ENTITY]);
    expect(waiting[0].data.labels).toBeUndefined();
    await h.flush();
    expect(h.calls.map((c) => c.name)).toEqual(["createTask", "patchTask"]);
    expect(Object.keys(h.calls[1].args[2] as object)).toEqual(["labels"]);
  });
});

/** Senders that work or fail with a network error, depending on `net.online`. */
function switchable() {
  const net = { online: false };
  const ok = (reply: () => unknown): Throwing => async () => {
    if (!net.online) throw new ApiError("network");
    return reply();
  };
  const behave: Record<string, Throwing> = {
    createTask: ok(() => makeTask({ id: "T" })),
    patchTask: ok(() => makeTask({ id: "T" })),
    createLabel: ok(() => ({ id: "L", projectId: "p1", name: "Urgent", colour: "red" })),
    createChecklist: ok(() => ({ id: "C", name: "Steps", createdAt: "x", items: [] })),
    createChecklistItem: ok(() => ({ id: "I", text: "a", done: false, createdAt: "x" })),
    patchChecklistItem: ok(() => ({ id: "I", text: "a", done: true, createdAt: "x" })),
  };
  return { net, behave };
}

describe("a task's labels and the label they need (AC14)", () => {
  const urgent: Label = { id: "L", projectId: "p1", name: "Urgent", colour: "red" };

  it("offline: task, checklist, ticked item, label, label on the task all go up in order and none is refused", async () => {
    const { net, behave } = switchable();
    const h = setup({}, behave);
    await h.enqueue({ entity: "task", entityId: "T", kind: "create", data: { projectId: "p1", title: "Trip" } });
    await h.enqueue({ entity: CHECKLIST_ENTITY, entityId: "C", kind: "create", data: { projectId: "p1", taskId: "T", name: "Steps" } });
    await h.enqueue({ entity: ITEM_ENTITY, entityId: "I", kind: "create", data: { projectId: "p1", taskId: "T", checklistId: "C", text: "a", done: false } });
    await h.enqueue({ entity: ITEM_ENTITY, entityId: "I", kind: "update", data: { projectId: "p1", taskId: "T", checklistId: "C", done: true } });
    await h.flush(); // offline: the task create is tried and fails
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "L", kind: "create", data: { projectId: "p1", name: "Urgent", colour: "red" } });
    const plan = planSetTaskLabels(makeTask({ id: "T" }), ["L"], [urgent], NOW);
    await queueTaskLabels(h.queue, (plan as { change: NewChange }).change);
    expect((await h.queue.waiting()).map((c) => c.entity)).toEqual(["task", CHECKLIST_ENTITY, ITEM_ENTITY, LABEL_ENTITY, TASK_LABELS_ENTITY]);

    net.online = true;
    h.calls.length = 0;
    await h.flush();
    expect(h.calls.map((c) => c.name)).toEqual([
      "createTask",
      "createChecklist",
      "createChecklistItem",
      "patchChecklistItem",
      "createLabel",
      "patchTask",
    ]);
    expect(h.calls[5].args.slice(0, 2)).toEqual(["p1", "T"]);
    expect(Object.keys(h.calls[5].args[2] as object)).toEqual(["labels"]);
    expect(await h.queue.count()).toBe(0);
    expect(h.notice).toBeNull();
  });

  it("a task update that was already tried keeps its place and carries no labels; the labels go after the label create", async () => {
    const { net, behave } = switchable();
    const h = setup({ tasks: [makeTask()] }, behave);
    await h.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", status: "done" } });
    await h.flush(); // tried once and failed: attempts is 1
    expect((await h.queue.waiting())[0].attempts).toBe(1);
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "L", kind: "create", data: { projectId: "p1", name: "Urgent", colour: "red" } });
    const plan = planSetTaskLabels(makeTask(), ["L"], [urgent], NOW);
    await queueTaskLabels(h.queue, (plan as { change: NewChange }).change);

    net.online = true;
    h.calls.length = 0;
    await h.flush();
    expect(h.calls.map((c) => c.name)).toEqual(["patchTask", "createLabel", "patchTask"]);
    expect(Object.keys(h.calls[0].args[2] as object)).toEqual(["status"]);
    expect(Object.keys(h.calls[2].args[2] as object)).toEqual(["labels"]);
    expect(h.notice).toBeNull();
  });

  it("a label set queued ahead of a label create it now uses is moved behind it; nothing else moves", async () => {
    const h = setup();
    await h.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", title: "x" } });
    await h.enqueue({ entity: TASK_LABELS_ENTITY, entityId: "t1", kind: "update", data: { projectId: "p1", labels: ["a"] } });
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "n", kind: "create", data: { projectId: "p1", name: "N", colour: "red" } });
    await queueTaskLabels(h.queue, {
      entity: TASK_LABELS_ENTITY,
      entityId: "t1",
      kind: "update",
      data: { projectId: "p1", labels: ["a", "n"] },
    });
    const waiting = await h.queue.waiting();
    expect(waiting.map((c) => c.entity)).toEqual(["task", LABEL_ENTITY, TASK_LABELS_ENTITY]);
    expect(waiting[2].data.labels).toEqual(["a", "n"]);
  });

  it("a label set that is already after the labels it uses is merged in place", async () => {
    const h = setup();
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "n", kind: "create", data: { projectId: "p1", name: "N", colour: "red" } });
    await h.enqueue({ entity: TASK_LABELS_ENTITY, entityId: "t1", kind: "update", data: { projectId: "p1", labels: ["a"] } });
    await queueTaskLabels(h.queue, { entity: TASK_LABELS_ENTITY, entityId: "t1", kind: "update", data: { projectId: "p1", labels: ["a", "n"] } });
    const waiting = await h.queue.waiting();
    expect(waiting.map((c) => c.entity)).toEqual([LABEL_ENTITY, TASK_LABELS_ENTITY]);
    expect(waiting[1].data.labels).toEqual(["a", "n"]);
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

  it("a refused item create over the limit removes the item from the local copy", async () => {
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

  it("a duplicate is taken off the waiting label set before it is sent, with a succeeding task patch (R15)", async () => {
    const h = setup(
      { tasks: [makeTask({ labelIds: ["dup", "ok"] })], labels },
      {
        createLabel: async () => Promise.reject(new ApiError("label_name_taken", 409)),
        patchTask: async () => makeTask(),
      },
    );
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "dup", kind: "create", data: { projectId: "p1", name: "Urgent", colour: "red" } });
    await h.queue.enqueue({ entity: TASK_LABELS_ENTITY, entityId: "t1", kind: "update", data: { projectId: "p1", labels: ["dup", "ok"] } });
    await h.queue.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", status: "done" } });
    await h.flush();
    const patches = h.calls.filter((c) => c.name === "patchTask").map((c) => c.args[2] as Record<string, { value: unknown }>);
    expect(patches).toHaveLength(2);
    expect(patches[0].labels.value).toEqual(["ok"]);
    expect(Object.keys(patches[1])).toEqual(["status"]); // the task's other edit is untouched
    expect(await h.queue.count()).toBe(0);
    expect(h.notice).toMatchObject({ subject: "label", reason: "labelNameTaken" });
  });

  it("a refused label set drops only the labels: the task's other waiting edits are still sent", async () => {
    const h = setup(
      { tasks: [makeTask({ labelIds: ["a"] })] },
      {
        patchTask: async (...args) => {
          const fields = args[2] as Record<string, unknown>;
          if ("labels" in fields) throw new ApiError("validation_failed", 400);
          return makeTask({ title: "Renamed" });
        },
      },
    );
    h.state.tasks = [makeTask({ labelIds: ["a", "b"] })]; // what the phone showed
    await h.enqueue({ entity: TASK_LABELS_ENTITY, entityId: "t1", kind: "update", data: { projectId: "p1", labels: ["a", "b"] } });
    await h.queue.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", title: "Renamed" } });
    await h.flush();
    expect(h.calls.map((c) => Object.keys(c.args[2] as object))).toEqual([["labels"], ["title"]]);
    expect(await h.queue.count()).toBe(0);
    expect(h.notice).toMatchObject({ subject: "taskLabels", reason: "invalid" });
    expect(noticeKeys(h.notice!).headline).toBe("tasks.rejectedTaskLabels");
    await h.cycle.refreshPending();
    expect(h.state.tasks[0].labelIds).toEqual(["a"]);
  });

  it("a refresh loads the project labels and keeps a waiting label create", async () => {
    const h = setup({ labels: [{ id: "a", name: "Urgent", colour: "red" }] });
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "b", kind: "create", data: { projectId: "p1", name: "Later", colour: "blue" } });
    expect(await h.cycle.refresh("p1")).toBe("ok");
    expect(h.state.labels.map((l) => l.name)).toEqual(["Urgent", "Later"]);
  });
});

describe("waiting label helpers", () => {
  it("stripLabelFromWaiting re-enqueues a waiting label set without the label, with a fresh time", async () => {
    const h = setup();
    await h.enqueue({ entity: TASK_LABELS_ENTITY, entityId: "t1", kind: "update", data: { projectId: "p1", labels: ["a", "b"] }, fieldTimes: { labels: NOW.toISOString(), projectId: NOW.toISOString() } });
    await stripLabelFromWaiting(h.queue, "p1", "a", LATER);
    const waiting = await h.queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data.labels).toEqual(["b"]);
    expect(waiting[0].fieldTimes.labels).toBe(LATER.toISOString());
  });

  it("a label the server deleted is taken off waiting label sets by the delete's sender", async () => {
    const h = setup({}, { deleteLabel: async () => undefined });
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "a", kind: "delete", data: { projectId: "p1", name: "Urgent" } });
    await h.queue.enqueue({ entity: TASK_LABELS_ENTITY, entityId: "t1", kind: "update", data: { projectId: "p1", labels: ["a", "b"] } });
    await h.flush();
    expect((await h.queue.waiting()).map((c) => c.data.labels)).toEqual([["b"]]);
  });

  it("deleting a label whose create was never sent sends no label request and keeps the other labels", async () => {
    const h = setup(
      { tasks: [makeTask({ labelIds: [] })] },
      { patchTask: async () => makeTask({ labelIds: ["a"] }) },
    );
    await h.enqueue({ entity: LABEL_ENTITY, entityId: "l", kind: "create", data: { projectId: "p1", name: "New", colour: "red" } });
    await h.queue.enqueue({ entity: TASK_LABELS_ENTITY, entityId: "t1", kind: "update", data: { projectId: "p1", labels: ["a", "l"] } });
    await queueLabelDelete(h.queue, { entity: LABEL_ENTITY, entityId: "l", kind: "delete", data: { projectId: "p1", name: "New" } }, new Date());
    await h.flush();
    expect(h.calls.filter((c) => c.name === "createLabel" || c.name === "deleteLabel")).toEqual([]);
    const patches = h.calls.filter((c) => c.name === "patchTask").map((c) => c.args[2] as Record<string, { value: unknown }>);
    expect(patches).toHaveLength(1);
    expect(patches[0].labels.value).toEqual(["a"]);
    expect(h.notice).toBeNull();
    expect(await h.queue.count()).toBe(0);
  });

  it("an untitled taskLabels refusal uses the untitled headline", () => {
    const keys = noticeKeys({ kind: "update", taskTitle: null, reason: "invalid", subject: "taskLabels" });
    expect(keys.headline).toBe("tasks.rejectedTaskLabelsNoTitle");
    expect(noticeKeys({ kind: "update", taskTitle: "T", reason: "invalid", subject: "taskLabels" }).headline).toBe("tasks.rejectedTaskLabels");
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
