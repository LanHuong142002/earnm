import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import { createQueue, type Queue } from "../sync/queue";
import { createMemoryStore } from "../sync/storage";
import type { Project } from "./api";
import { PROJECT_ENTITY, registerProjectEntity } from "./sync";
import { createSyncCycle, type SyncStatus } from "./syncCycle";
import type { RejectedNotice } from "./outcomes";

const A: Project = { id: "a", name: "Alpha", description: "", currency: "VND", role: "owner" };
const B: Project = { id: "b", name: "Beta", description: "", currency: "USD", role: "member" };
const USER = "user-1";

type Server = { patch: () => Promise<unknown>; list: Project[]; listError?: ApiError };

function setup(server: Server, initial: Project[]) {
  let list = initial;
  let notice: RejectedNotice | null = null;
  let status: SyncStatus = "loading";
  let waiting = -1;
  let token: string | null = "tok";
  const onNotSignedIn = vi.fn();
  const patchProject = vi.fn(() => server.patch());
  let queue!: Queue;
  const cycle = createSyncCycle({
    getQueue: () => queue,
    getToken: async () => token,
    listProjects: async () => {
      if (server.listError) throw server.listError;
      return server.list;
    },
    getProjects: () => list,
    commit: async (next) => {
      list = next;
    },
    setNotice: (n) => {
      notice = n;
    },
    setWaitingCount: (n) => {
      waiting = n;
    },
    setStatus: (update) => {
      status = typeof update === "function" ? update(status) : update;
    },
    getGeneration: () => 0,
    isWiped: () => false,
    settleMutations: async () => queue.waiting(),
    onNotSignedIn,
  });
  queue = createQueue({ store: createMemoryStore(), getToken: async () => token, ...cycle.handlers });
  registerProjectEntity(queue, {
    createProject: vi.fn(),
    patchProject,
    deleteProject: vi.fn(),
  } as never);
  return {
    queue,
    cycle,
    patchProject,
    onNotSignedIn,
    setToken: (t: string | null) => {
      token = t;
    },
    get list() {
      return list;
    },
    get notice() {
      return notice;
    },
    get status() {
      return status;
    },
    get waiting() {
      return waiting;
    },
  };
}

async function editName(h: ReturnType<typeof setup>, name: string) {
  await h.queue.setOwner(USER);
  await h.queue.enqueue({ entity: PROJECT_ENTITY, entityId: "a", kind: "update", data: { name } });
}

describe("sync cycle: a change the server refuses for good (AC26)", () => {
  it("403: the change leaves the queue, the list shows the server's version, the notice names the project", async () => {
    const h = setup({ patch: async () => { throw new ApiError("forbidden", 403); }, list: [A, B] }, [
      { ...A, name: "Edited offline" },
      B,
    ]);
    await editName(h, "Edited offline");
    await h.cycle.sync(USER);
    expect(await h.queue.count()).toBe(0);
    expect(h.list.find((p) => p.id === "a")?.name).toBe("Alpha");
    expect(h.notice).toEqual({ kind: "update", projectName: "Edited offline", reason: "forbidden" });
    expect(h.waiting).toBe(0);
    expect(h.status).toBe("ready");
  });

  it("404: the project is gone from the list and the notice is set", async () => {
    const h = setup({ patch: async () => { throw new ApiError("not_found", 404); }, list: [B] }, [
      { ...A, name: "Edited offline" },
      B,
    ]);
    await editName(h, "Edited offline");
    await h.cycle.sync(USER);
    expect(await h.queue.count()).toBe(0);
    expect(h.list.map((p) => p.id)).toEqual(["b"]);
    expect(h.notice?.reason).toBe("not_found");
    expect(h.notice?.projectName).toBe("Edited offline");
  });

  it("flush alone also restores the server's version after a 403", async () => {
    const h = setup({ patch: async () => { throw new ApiError("forbidden", 403); }, list: [A, B] }, [
      { ...A, name: "Edited offline" },
      B,
    ]);
    await editName(h, "Edited offline");
    await h.cycle.flush(USER);
    expect(h.list.find((p) => p.id === "a")?.name).toBe("Alpha");
  });
});

describe("sync cycle: not signed in (AC27)", () => {
  it("a 401 calls the handler and keeps the change; flushing again for the same owner sends it", async () => {
    let calls = 0;
    const h = setup(
      {
        patch: async () => {
          calls += 1;
          if (calls === 1) throw new ApiError("not_signed_in", 401);
          return { ...A, name: "Edited offline" };
        },
        list: [{ ...A, name: "Edited offline" }, B],
      },
      [{ ...A, name: "Edited offline" }, B],
    );
    await editName(h, "Edited offline");
    await h.cycle.flush(USER);
    expect(h.onNotSignedIn).toHaveBeenCalledTimes(1);
    expect(await h.queue.count()).toBe(1);
    expect(h.notice).toBeNull();

    h.setToken("fresh");
    await h.cycle.flush(USER);
    expect(h.patchProject).toHaveBeenCalledTimes(2);
    expect(await h.queue.count()).toBe(0);
    expect(h.notice).toBeNull();
  });

  it("does not send when the owner is not the stored one", async () => {
    const h = setup({ patch: async () => ({}), list: [A] }, [A]);
    await editName(h, "X");
    await h.cycle.flush("someone-else");
    expect(h.patchProject).not.toHaveBeenCalled();
    expect(await h.queue.count()).toBe(1);
  });
});

describe("sync cycle: refresh errors", () => {
  it("a network failure marks the app offline", async () => {
    const h = setup({ patch: async () => ({}), list: [], listError: new ApiError("network") }, [A]);
    await h.cycle.refresh();
    expect(h.status).toBe("offline");
    expect(h.list).toEqual([A]);
  });

  it("a 401 on the list calls the not-signed-in handler", async () => {
    const h = setup({ patch: async () => ({}), list: [], listError: new ApiError("not_signed_in", 401) }, [A]);
    await h.cycle.refresh();
    expect(h.onNotSignedIn).toHaveBeenCalledTimes(1);
  });
});

describe("sync cycle: refresh content", () => {
  it("a project missing from the server list is gone after refresh (AC19)", async () => {
    const h = setup({ patch: async () => ({}), list: [A] }, [A, B]);
    await h.cycle.refresh();
    expect(h.list.map((p) => p.id)).toEqual(["a"]);
  });

  it("a malformed entry in the server list is dropped without losing the rest", async () => {
    const bad = { id: "x", name: 5 } as unknown as Project;
    const h = setup({ patch: async () => ({}), list: [A, bad, B] }, []);
    await h.cycle.refresh();
    expect(h.list.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("a malformed patch reply does not wipe the project from the list", async () => {
    const h = setup({ patch: async () => ({ nope: true }), list: [A, B] }, [{ ...A, name: "Edited" }, B]);
    await editName(h, "Edited");
    await h.cycle.flush(USER);
    expect(h.list.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
