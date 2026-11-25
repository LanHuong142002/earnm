import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import type { Change } from "../sync/queue";
import { draft, draftLine } from "./fixtures";
import type { Draft } from "./types";
import { createDraftSyncCycle, draftReasonFor, type DraftRejectedNotice } from "./syncCycle";

const change = (over: Partial<Change> = {}): Change => ({
  changeId: "c1",
  entity: "draft",
  entityId: "d1",
  kind: "update",
  data: { projectId: "p1" },
  fieldTimes: {},
  createdAt: "2026-11-18T09:00:00.000Z",
  ...over,
});

function setup(initial: Record<string, Draft[]> = { p1: [draft({ id: "d1", name: "Cũ", lines: [draftLine({ id: "l1" })] })] }) {
  let entries = initial;
  let totals: Record<string, number> = {};
  const notices: DraftRejectedNotice[] = [];
  const deps = {
    getToken: vi.fn(async () => "tok" as string | null),
    listDrafts: vi.fn(async (): Promise<{ drafts: Draft[]; convertedTotal?: number }> => ({
      drafts: [draft({ id: "d1", name: "Từ máy chủ" })],
      convertedTotal: 73,
    })),
    getEntry: (projectId: string) => entries[projectId] ?? null,
    commit: async (projectId: string, list: Draft[], convertedTotal?: number) => {
      entries = { ...entries, [projectId]: list };
      if (convertedTotal !== undefined) totals = { ...totals, [projectId]: convertedTotal };
    },
    setNotice: (n: DraftRejectedNotice) => void notices.push(n),
    getGeneration: () => 0,
    isWiped: () => false,
    onNotSignedIn: vi.fn(),
  };
  return { cycle: createDraftSyncCycle(deps), deps, notices, get: () => entries, totals: () => totals };
}

describe("draft sync cycle", () => {
  it("replaces the cached draft with the server's reply, whichever change made it", async () => {
    const s = setup();
    s.cycle.handlers.onApplied(change({ entity: "draftLine", entityId: "l1", data: { projectId: "p1", draftId: "d1" } }), draft({ id: "d1", name: "Mới" }));
    await s.cycle.idle();
    expect(s.get().p1).toMatchObject([{ id: "d1", name: "Mới" }]);
  });

  it("adds a created draft, removes a deleted one, and removes a deleted line", async () => {
    const s = setup();
    s.cycle.handlers.onApplied(change({ kind: "create", entityId: "d2" }), draft({ id: "d2" }));
    await s.cycle.idle();
    expect(s.get().p1.map((d) => d.id)).toEqual(["d1", "d2"]);
    s.cycle.handlers.onApplied(change({ entity: "draftLine", entityId: "l1", kind: "delete", data: { projectId: "p1", draftId: "d1" } }), undefined);
    await s.cycle.idle();
    expect(s.get().p1[0].lines).toEqual([]);
    s.cycle.handlers.onApplied(change({ kind: "delete", entityId: "d1" }), undefined);
    await s.cycle.idle();
    expect(s.get().p1.map((d) => d.id)).toEqual(["d2"]);
  });

  it("sets a notice with the draft's name and the missing list of an incomplete Done, then refreshes", async () => {
    const s = setup();
    const missing = [{ code: "lines" }];
    s.cycle.handlers.onRejected(change({ entity: "draftStatus", data: { projectId: "p1", value: "done" } }), new ApiError("draft_incomplete", 409, null, { missing }));
    await s.cycle.idle();
    expect(s.notices).toEqual([{ entity: "draftStatus", kind: "update", name: "Cũ", reason: "incomplete", missing }]);
    await s.cycle.refreshPending();
    expect(s.get().p1[0].name).toBe("Từ máy chủ");
  });

  it("uses the draft's own name from the change when it was never cached, and the line's draft for a line", async () => {
    const s = setup();
    s.cycle.handlers.onRejected(change({ kind: "create", entityId: "d9", data: { projectId: "p1", name: "Mới" } }), new ApiError("draft_limit_reached", 409));
    s.cycle.handlers.onRejected(change({ entity: "draftLine", entityId: "l1", kind: "create", data: { projectId: "p1", draftId: "d1" } }), new ApiError("draft_line_duplicate", 409));
    await s.cycle.idle();
    expect(s.notices).toMatchObject([
      { entity: "draft", kind: "create", name: "Mới", reason: "limit" },
      { entity: "draftLine", kind: "create", name: "Cũ", reason: "duplicateLine" },
    ]);
  });

  it("maps server codes to reasons", () => {
    expect(draftReasonFor(new ApiError("draft_converted", 409))).toBe("converted");
    expect(draftReasonFor(new ApiError("draft_line_limit_reached", 409))).toBe("limit");
    expect(draftReasonFor(new ApiError("ingredient_limit_reached", 409))).toBe("limit");
    expect(draftReasonFor(new ApiError("draft_line_name_taken", 409))).toBe("nameTaken");
    expect(draftReasonFor(new ApiError("ingredient_name_taken", 409))).toBe("nameTaken");
    expect(draftReasonFor(new ApiError("id_conflict", 409))).toBe("conflict");
  });

  it("refreshes: lists and saves; a 404 empties the project; offline keeps the cache", async () => {
    const s = setup();
    expect(await s.cycle.refresh("p1")).toBe("ok");
    expect(s.get().p1[0].name).toBe("Từ máy chủ");
    expect(s.totals()).toEqual({ p1: 73 });
    s.deps.listDrafts.mockRejectedValueOnce(new ApiError("not_found", 404));
    expect(await s.cycle.refresh("p1")).toBe("gone");
    expect(s.get().p1).toEqual([]);
    s.deps.listDrafts.mockRejectedValueOnce(new ApiError("network"));
    expect(await s.cycle.refresh("p1")).toBe("offline");
  });
});
