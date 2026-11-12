import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { createQueue, type Queue } from "../sync/queue";
import { createMemoryStore } from "../sync/storage";
import { makeTask } from "./fixtures";
import type { TaskRejectedNotice } from "./outcomes";
import { registerTaskEntity } from "./sync";
import { createTaskSyncCycle } from "./syncCycle";
import type { Task } from "./types";

const USER = "user-1";

type Server = {
  patch?: (projectId: string, taskId: string) => Promise<unknown>;
  lists?: Record<string, Task[] | ApiError>;
};

function setup(server: Server, initial: Record<string, Task[]>) {
  const lists: Record<string, Task[]> = { ...initial };
  let notice: TaskRejectedNotice | null = null;
  let token: string | null = "tok";
  const onNotSignedIn = vi.fn();
  const queueLevel = { onApplied: vi.fn(), onRejected: vi.fn(), onSignedOut: vi.fn() };
  const patchTask = vi.fn(async (_token: string, projectId: string, taskId: string) => server.patch?.(projectId, taskId));
  const listTasks = vi.fn(async (_token: string, projectId: string) => {
    const result = server.lists?.[projectId] ?? [];
    if (result instanceof ApiError) throw result;
    return result;
  });
  let queue!: Queue;
  const cycle = createTaskSyncCycle({
    getQueue: () => queue,
    getToken: async () => token,
    listTasks,
    getTasks: (projectId) => lists[projectId] ?? [],
    commit: async (projectId, next) => {
      lists[projectId] = next;
    },
    setNotice: (n) => {
      notice = n;
    },
    getGeneration: () => 0,
    isWiped: () => false,
    settleMutations: async () => queue.waiting(),
    onNotSignedIn,
  });
  queue = createQueue({ store: createMemoryStore(), getToken: async () => token, ...queueLevel });
  registerTaskEntity(queue, cycle.handlers, { createTask: vi.fn(), patchTask, deleteTask: vi.fn() } as never);
  return {
    queue,
    cycle,
    flush: async (owner: string) => {
      await queue.flush(owner);
      await cycle.idle();
    },
    patchTask,
    listTasks,
    queueLevel,
    onNotSignedIn,
    lists,
    setToken: (t: string | null) => {
      token = t;
    },
    get notice() {
      return notice;
    },
  };
}

type Harness = ReturnType<typeof setup>;

async function rename(h: Harness, projectId: string, taskId: string, title: string) {
  await h.queue.setOwner(USER);
  await h.queue.enqueue({ entity: "task", entityId: taskId, kind: "update", data: { projectId, title } });
}

describe("a task change the server refuses for good (AC17)", () => {
  it("403: removed from the queue, the refresh restores the server's version, the notice names the task", async () => {
    const local = makeTask({ title: "Edited offline" });
    const h = setup(
      {
        patch: async () => {
          throw new ApiError("forbidden", 403);
        },
        lists: { p1: [makeTask({ title: "Buy paint" })] },
      },
      { p1: [local] },
    );
    await rename(h, "p1", "t1", "Edited offline");
    await h.flush(USER);
    expect(await h.queue.count()).toBe(0);
    expect(h.notice).toEqual({ kind: "update", taskTitle: "Edited offline", reason: "forbidden" });
    await h.cycle.refreshPending();
    expect(h.lists.p1[0].title).toBe("Buy paint");
    expect(h.queueLevel.onRejected).not.toHaveBeenCalled();
  });

  it("404: the task leaves the list", async () => {
    const h = setup(
      {
        patch: async () => {
          throw new ApiError("not_found", 404);
        },
        lists: { p1: [makeTask({ id: "t2" })] },
      },
      { p1: [makeTask(), makeTask({ id: "t2" })] },
    );
    await rename(h, "p1", "t1", "x");
    await h.flush(USER);
    expect(await h.queue.count()).toBe(0);
    expect(h.lists.p1.map((t) => t.id)).toEqual(["t2"]);
    expect(h.notice?.reason).toBe("not_found");
    await h.cycle.refreshPending();
    expect(h.lists.p1.map((t) => t.id)).toEqual(["t2"]);
  });

  it("401: the change stays queued, no notice, and sends again after signing in", async () => {
    let calls = 0;
    const h = setup(
      {
        patch: async () => {
          calls += 1;
          if (calls === 1) throw new ApiError("not_signed_in", 401);
          return makeTask({ title: "x" });
        },
      },
      { p1: [makeTask()] },
    );
    await rename(h, "p1", "t1", "x");
    await h.flush(USER);
    expect(await h.queue.count()).toBe(1);
    expect(h.notice).toBeNull();
    expect(h.queueLevel.onSignedOut).toHaveBeenCalledTimes(1);
    await h.flush(USER);
    expect(h.patchTask).toHaveBeenCalledTimes(2);
    expect(await h.queue.count()).toBe(0);
    expect(h.lists.p1[0].title).toBe("x");
  });
});

describe("a task change the server accepts", () => {
  it("the cached task becomes the server's response", async () => {
    const saved = makeTask({ title: "Saved", status: "doing" });
    const h = setup({ patch: async () => saved }, { p1: [makeTask({ title: "Saved" })] });
    await rename(h, "p1", "t1", "Saved");
    await h.flush(USER);
    expect(h.lists.p1).toEqual([saved]);
    expect(h.notice).toBeNull();
  });

  it("a malformed reply does not wipe the task; the project is marked for refresh", async () => {
    const h = setup({ patch: async () => ({ nope: true }) }, { p1: [makeTask({ title: "x" })] });
    await rename(h, "p1", "t1", "x");
    await h.flush(USER);
    expect(h.lists.p1.map((t) => t.id)).toEqual(["t1"]);
    expect(h.listTasks).not.toHaveBeenCalled();
    await h.cycle.refreshPending();
    expect(h.listTasks).toHaveBeenCalledTimes(1);
    expect(h.listTasks.mock.calls[0][1]).toBe("p1");
  });
});

describe("a change for a deleted project (AC18)", () => {
  it("is dropped on 404 and the next waiting change is still sent", async () => {
    const h = setup(
      {
        patch: async (projectId) => {
          if (projectId === "gone") throw new ApiError("not_found", 404);
          return makeTask({ id: "t9", projectId: "p2", title: "second" });
        },
        lists: { gone: new ApiError("not_found", 404) },
      },
      { gone: [makeTask({ id: "t1", projectId: "gone" })], p2: [makeTask({ id: "t9", projectId: "p2" })] },
    );
    await h.queue.setOwner(USER);
    await h.queue.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "gone", title: "first" } });
    await h.queue.enqueue({ entity: "task", entityId: "t9", kind: "update", data: { projectId: "p2", title: "second" } });
    await h.flush(USER);
    expect(h.patchTask).toHaveBeenCalledTimes(2);
    expect(await h.queue.count()).toBe(0);
    expect(h.lists.gone).toEqual([]);
    expect(h.lists.p2[0].title).toBe("second");
    expect(h.notice?.reason).toBe("not_found");
    await h.cycle.refreshPending();
    expect(h.lists.gone).toEqual([]);
  });
});

describe("refreshPending", () => {
  it("keeps a project marked when its refresh fails, so the next flush retries it", async () => {
    const h = setup({ patch: async () => ({ nope: true }), lists: { p1: new ApiError("internal_error", 500) } }, { p1: [makeTask()] });
    await rename(h, "p1", "t1", "x");
    await h.flush(USER);
    await h.cycle.refreshPending();
    expect(h.listTasks).toHaveBeenCalledTimes(1);
    await h.cycle.refreshPending();
    expect(h.listTasks).toHaveBeenCalledTimes(2);
  });

  it("clears the mark once the refresh succeeds", async () => {
    const h = setup({ patch: async () => ({ nope: true }), lists: { p1: [makeTask()] } }, { p1: [makeTask()] });
    await rename(h, "p1", "t1", "x");
    await h.flush(USER);
    await h.cycle.refreshPending();
    expect(h.listTasks).toHaveBeenCalledTimes(1);
    await h.cycle.refreshPending();
    expect(h.listTasks).toHaveBeenCalledTimes(1);
  });
});

describe("refresh(projectId)", () => {
  it("lists, replays the waiting changes, then commits", async () => {
    const h = setup({ lists: { p1: [makeTask({ title: "Old" }), makeTask({ id: "t2" })] } }, {});
    await h.queue.setOwner(USER);
    await h.queue.enqueue({ entity: "task", entityId: "t1", kind: "update", data: { projectId: "p1", title: "New" } });
    expect(await h.cycle.refresh("p1")).toBe("ok");
    expect(h.lists.p1.map((t) => t.title)).toEqual(["New", "Buy paint"]);
  });

  it("a task missing from the server list is gone", async () => {
    const h = setup({ lists: { p1: [makeTask({ id: "a" })] } }, { p1: [makeTask({ id: "a" }), makeTask({ id: "b" })] });
    await h.cycle.refresh("p1");
    expect(h.lists.p1.map((t) => t.id)).toEqual(["a"]);
  });

  it("a network failure keeps the cache and reports offline", async () => {
    const h = setup({ lists: { p1: new ApiError("network") } }, { p1: [makeTask()] });
    expect(await h.cycle.refresh("p1")).toBe("offline");
    expect(h.lists.p1).toHaveLength(1);
  });

  it("a 500 is treated like offline", async () => {
    const h = setup({ lists: { p1: new ApiError("server", 500) } }, { p1: [makeTask()] });
    expect(await h.cycle.refresh("p1")).toBe("offline");
    expect(h.lists.p1).toHaveLength(1);
    expect(h.onNotSignedIn).not.toHaveBeenCalled();
  });

  it("a 401 calls the not-signed-in handler and keeps the cache", async () => {
    const h = setup({ lists: { p1: new ApiError("not_signed_in", 401) } }, { p1: [makeTask()] });
    await h.cycle.refresh("p1");
    expect(h.onNotSignedIn).toHaveBeenCalledTimes(1);
    expect(h.lists.p1).toHaveLength(1);
  });

  it("a 404 for the project empties its cached list", async () => {
    const h = setup({ lists: { p1: new ApiError("not_found", 404) } }, { p1: [makeTask()] });
    expect(await h.cycle.refresh("p1")).toBe("gone");
    expect(h.lists.p1).toEqual([]);
  });

  it("no token: nothing is requested", async () => {
    const h = setup({}, { p1: [makeTask()] });
    h.setToken(null);
    expect(await h.cycle.refresh("p1")).toBe("skipped");
    expect(h.listTasks).not.toHaveBeenCalled();
  });

  it("drops a malformed entry without losing the rest", async () => {
    const bad = { id: "x", title: 5 } as unknown as Task;
    const h = setup({ lists: { p1: [makeTask({ id: "a" }), bad] } }, {});
    await h.cycle.refresh("p1");
    expect(h.lists.p1.map((t) => t.id)).toEqual(["a"]);
  });
});
