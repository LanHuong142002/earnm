import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import type { Change } from "../sync/queue";
import { idea } from "./fixtures";
import { createIdeaSyncCycle, ideaReasonFor, type IdeaRejectedNotice } from "./syncCycle";
import type { Idea } from "./types";

const change = (over: Partial<Change> = {}): Change => ({
  changeId: "c1",
  entity: "idea",
  entityId: "i1",
  kind: "update",
  data: { projectId: "p1" },
  fieldTimes: {},
  createdAt: "2026-11-18T09:00:00.000Z",
  ...over,
});

/** The project lists as the cache holds them; a project that was never fetched has no entry. */
type Lists = Record<string, Idea[]>;

function setup(initial: Lists = { p1: [idea({ id: "i1", title: "Cũ" })] }, listed: Idea[] = []) {
  let lists = initial;
  let generation = 0;
  const notices: IdeaRejectedNotice[] = [];
  const deps = {
    getToken: vi.fn(async () => "tok" as string | null),
    listIdeas: vi.fn(async () => listed),
    getIdeas: (projectId: string) => lists[projectId] ?? null,
    commit: async (projectId: string, list: Idea[]) => {
      lists = { ...lists, [projectId]: list };
    },
    setNotice: (n: IdeaRejectedNotice) => void notices.push(n),
    getGeneration: () => generation,
    isWiped: () => false,
    onNotSignedIn: vi.fn(),
  };
  const cycle = createIdeaSyncCycle(deps);
  return { cycle, deps, notices, get: () => lists, bump: () => void generation++ };
}

describe("idea sync cycle", () => {
  it("replaces the cached idea with the server's reply", async () => {
    const s = setup();
    s.cycle.handlers.onApplied(change(), idea({ id: "i1", title: "Mới", score: 3 }));
    await s.cycle.idle();
    expect(s.get().p1).toMatchObject([{ id: "i1", title: "Mới", score: 3 }]);
  });

  it("adds an idea the server just created", async () => {
    const s = setup();
    s.cycle.handlers.onApplied(change({ kind: "create", entityId: "i2" }), idea({ id: "i2" }));
    await s.cycle.idle();
    expect(s.get().p1.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("removes a deleted idea", async () => {
    const s = setup();
    s.cycle.handlers.onApplied(change({ kind: "delete" }), undefined);
    await s.cycle.idle();
    expect(s.get().p1).toEqual([]);
  });

  it("a malformed reply leaves the cache alone and fetches the project again", async () => {
    const s = setup(undefined, [idea({ id: "i1", title: "Từ máy chủ" })]);
    s.cycle.handlers.onApplied(change(), { nonsense: true });
    await s.cycle.idle();
    expect(s.get().p1[0].title).toBe("Cũ");
    await s.cycle.refreshPending();
    expect(s.get().p1[0].title).toBe("Từ máy chủ");
  });

  it("a reply for a project that was never fetched does not make a one-idea list", async () => {
    const s = setup({});
    s.cycle.handlers.onApplied(change({ kind: "create" }), idea({ id: "i1" }));
    await s.cycle.idle();
    expect(s.get().p1).toBeUndefined();
  });

  it("a refused change sets the notice with the idea's title and fetches the project again", async () => {
    const s = setup(undefined, [idea({ id: "i1", title: "Từ máy chủ" })]);
    s.cycle.handlers.onRejected(change({ kind: "update" }), new ApiError("forbidden", 403));
    await s.cycle.idle();
    expect(s.notices).toEqual([{ kind: "update", ideaTitle: "Cũ", reason: "forbidden" }]);
    await s.cycle.refreshPending();
    expect(s.deps.listIdeas).toHaveBeenCalledTimes(1);
  });

  it("a refused create names the idea from the change", async () => {
    const s = setup();
    s.cycle.handlers.onRejected(change({ kind: "create", entityId: "i9", data: { projectId: "p1", title: "Mới" } }), new ApiError("idea_limit_reached", 409));
    await s.cycle.idle();
    expect(s.notices).toEqual([{ kind: "create", ideaTitle: "Mới", reason: "limit" }]);
  });

  it("refresh saves the server's list, and skips without a token or after the session changed", async () => {
    const s = setup(undefined, [idea({ id: "a" }), idea({ id: "b" })]);
    expect(await s.cycle.refresh("p1")).toBe("ok");
    expect(s.get().p1.map((i) => i.id)).toEqual(["a", "b"]);
    s.deps.getToken.mockResolvedValueOnce(null);
    expect(await s.cycle.refresh("p1")).toBe("skipped");
    s.deps.listIdeas.mockImplementationOnce(async () => {
      s.bump();
      return [];
    });
    expect(await s.cycle.refresh("p1")).toBe("skipped");
    expect(s.get().p1).toHaveLength(2);
  });

  it("refresh tells offline from an error, empties a project that is gone, and signs out", async () => {
    const s = setup();
    s.deps.listIdeas.mockRejectedValueOnce(new ApiError("network"));
    expect(await s.cycle.refresh("p1")).toBe("offline");
    s.deps.listIdeas.mockRejectedValueOnce(new ApiError("server_error", 500));
    expect(await s.cycle.refresh("p1")).toBe("error");
    expect(s.get().p1).toHaveLength(1);
    s.deps.listIdeas.mockRejectedValueOnce(new ApiError("not_found", 404));
    expect(await s.cycle.refresh("p1")).toBe("gone");
    expect(s.get().p1).toEqual([]);
    s.deps.listIdeas.mockRejectedValueOnce(new ApiError("not_signed_in", 401));
    expect(await s.cycle.refresh("p1")).toBe("skipped");
    expect(s.deps.onNotSignedIn).toHaveBeenCalled();
  });
});

describe("ideaReasonFor", () => {
  it("reads the idea limit as a limit and falls back to the task reasons", () => {
    expect(ideaReasonFor(new ApiError("idea_limit_reached", 409))).toBe("limit");
    expect(ideaReasonFor(new ApiError("forbidden", 403))).toBe("forbidden");
    expect(ideaReasonFor(new ApiError("validation_failed", 400))).toBe("invalid");
  });
});
