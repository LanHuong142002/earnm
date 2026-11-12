import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { createQueue, type Change, type ChangeKind, type Queue, type Sender } from "../sync/queue";
import { createMemoryStore } from "../sync/storage";
import { TASK_ENTITY, registerTaskEntity } from "./sync";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";
const T2 = "2026-01-01T00:00:02.000Z";

function deps() {
  return {
    createTask: vi.fn(async (..._args: unknown[]) => ({})),
    patchTask: vi.fn(async (..._args: unknown[]) => ({})),
    deleteTask: vi.fn(async (..._args: unknown[]) => undefined),
  };
}

function direct() {
  let senders!: Record<ChangeKind, Sender>;
  let entity = "";
  let handlers: unknown;
  const queue = {
    registerEntity: (e: string, s: Record<ChangeKind, Sender>, h?: unknown) => {
      entity = e;
      senders = s;
      handlers = h;
    },
  } as unknown as Queue;
  const d = deps();
  const myHandlers = { onApplied: vi.fn(), onRejected: vi.fn() };
  registerTaskEntity(queue, myHandlers, d);
  return { senders, entity, handlers, myHandlers, d };
}

const base: Change = {
  changeId: "c",
  entity: "task",
  entityId: "t1",
  kind: "create",
  data: { projectId: "p1" },
  fieldTimes: {},
  createdAt: T0,
};

describe("registerTaskEntity", () => {
  it("registers under the task entity with the given handlers", () => {
    const h = direct();
    expect(h.entity).toBe(TASK_ENTITY);
    expect(TASK_ENTITY).toBe("task");
    expect(h.handlers).toBe(h.myHandlers);
  });

  it("create sends every field with the latest field time", async () => {
    const h = direct();
    await h.senders.create(
      {
        ...base,
        data: {
          projectId: "p1",
          title: "Paint",
          description: "two coats",
          status: "doing",
          due: { date: "2026-11-14", time: "14:30" },
          assignees: ["u2"],
          assigneeNames: { u2: "Huy" },
          createdById: "u1",
        },
        fieldTimes: { title: T1, status: T2 },
      },
      "tok",
    );
    expect(h.d.createTask).toHaveBeenCalledWith("tok", "p1", {
      id: "t1",
      title: "Paint",
      description: "two coats",
      status: "doing",
      dueDate: "2026-11-14",
      dueTime: "14:30",
      assigneeIds: ["u2"],
      editedAt: T2,
    });
  });

  it("create with no due date and no field times omits the due fields and uses createdAt", async () => {
    const h = direct();
    await h.senders.create({ ...base, data: { projectId: "p1", title: "Paint", due: null } }, "tok");
    expect(h.d.createTask).toHaveBeenCalledWith("tok", "p1", { id: "t1", title: "Paint", editedAt: T0 });
  });

  it("create with a day only sends dueDate without dueTime", async () => {
    const h = direct();
    await h.senders.create({ ...base, data: { projectId: "p1", title: "P", due: { date: "2026-11-14", time: null } } }, "tok");
    expect(h.d.createTask).toHaveBeenCalledWith("tok", "p1", { id: "t1", title: "P", dueDate: "2026-11-14", editedAt: T0 });
  });

  it("update sends { value, editedAt } for each touched field only", async () => {
    const h = direct();
    await h.senders.update(
      {
        ...base,
        kind: "update",
        data: { projectId: "p1", title: "New", due: null, assignees: ["u1"], assigneeNames: { u1: "Lan" } },
        fieldTimes: { title: T1, due: T2 },
      },
      "tok",
    );
    expect(h.d.patchTask).toHaveBeenCalledWith("tok", "p1", "t1", {
      title: { value: "New", editedAt: T1 },
      due: { value: null, editedAt: T2 },
      assignees: { value: ["u1"], editedAt: T0 },
    });
  });

  it("delete sends the project and task ids", async () => {
    const h = direct();
    await h.senders.delete({ ...base, kind: "delete" }, "tok");
    expect(h.d.deleteTask).toHaveBeenCalledWith("tok", "p1", "t1");
  });
});

describe("merging task changes in the shared queue (AC16)", () => {
  function realQueue() {
    const d = deps();
    const queue = createQueue({
      store: createMemoryStore(),
      getToken: async () => "tok",
      onApplied: vi.fn(),
      onRejected: vi.fn(),
      onSignedOut: vi.fn(),
    });
    registerTaskEntity(queue, {}, d);
    return { queue, d };
  }

  it("two edits of one task leave one waiting change", async () => {
    const { queue } = realQueue();
    await queue.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", title: "A" } });
    await queue.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", status: "done" } });
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data).toMatchObject({ title: "A", status: "done" });
  });

  it("create then edit leaves one create holding the edit", async () => {
    const { queue } = realQueue();
    await queue.enqueue({
      entity: "task",
      entityId: "t1",
      kind: "create",
      data: { projectId: "p1", title: "A", description: "", status: "todo", due: null, assignees: [] },
    });
    await queue.enqueue({
      entity: "task",
      entityId: "t1",
      kind: "update",
      data: { projectId: "p1", title: "B", due: { date: "2026-11-14", time: null } },
    });
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].kind).toBe("create");
    expect(waiting[0].data).toMatchObject({ title: "B", due: { date: "2026-11-14", time: null } });
  });

  it("create then delete leaves nothing and sends no request", async () => {
    const { queue, d } = realQueue();
    await queue.enqueue({ entity: "task", entityId: "t1", kind: "create", data: { projectId: "p1", title: "A" } });
    await queue.enqueue({ entity: "task", entityId: "t1", kind: "delete", data: { projectId: "p1" } });
    await queue.setOwner("u1");
    await queue.flush("u1");
    expect(await queue.count()).toBe(0);
    expect(d.createTask).not.toHaveBeenCalled();
    expect(d.deleteTask).not.toHaveBeenCalled();
  });

  it("a task change and a project change with the same id do not merge", async () => {
    const { queue } = realQueue();
    queue.registerEntity("project", { create: vi.fn(), update: vi.fn(), delete: vi.fn() } as never);
    await queue.enqueue({ entity: "project", entityId: "t1", kind: "update", data: { name: "x" } });
    await queue.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", title: "x" } });
    expect(await queue.count()).toBe(2);
  });
});

describe("handlers", () => {
  it("a task change reaches only the task handlers, not the queue-level ones", async () => {
    const queueLevel = { onApplied: vi.fn(), onRejected: vi.fn() };
    const queue = createQueue({
      store: createMemoryStore(),
      getToken: async () => "tok",
      ...queueLevel,
      onSignedOut: vi.fn(),
    });
    const mine = { onApplied: vi.fn(), onRejected: vi.fn() };
    registerTaskEntity(queue, mine, {
      ...deps(),
      patchTask: vi.fn(async () => {
        throw new ApiError("forbidden", 403);
      }),
    });
    await queue.setOwner("u1");
    await queue.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", title: "x" } });
    await queue.flush("u1");
    expect(mine.onRejected).toHaveBeenCalledTimes(1);
    expect(queueLevel.onRejected).not.toHaveBeenCalled();
    expect(queueLevel.onApplied).not.toHaveBeenCalled();
  });
});
