import { describe, expect, it } from "vitest";

import { ApiError } from "../lib/api";
import type { Change } from "../sync/queue";
import { makeTask } from "./fixtures";
import { noticeKeys, onApplied, onRejected } from "./outcomes";

function change(over: Partial<Change> = {}): Change {
  return {
    changeId: "c1",
    entity: "task",
    entityId: "t1",
    kind: "update",
    data: { projectId: "p1", title: "Renamed offline" },
    fieldTimes: {},
    createdAt: "2026-11-12T09:00:00.000Z",
    ...over,
  };
}

describe("onApplied", () => {
  it("replaces the cached task with the server's, then replays what still waits", () => {
    const list = [makeTask({ title: "Local" })];
    const server = makeTask({ title: "Server", status: "doing" });
    const waiting = [change({ changeId: "c2", data: { projectId: "p1", status: "done" } })];
    expect(onApplied(list, change(), server, waiting)[0]).toMatchObject({ title: "Server", status: "done" });
  });

  it("a delete takes the task out", () => {
    expect(onApplied([makeTask()], change({ kind: "delete", data: { projectId: "p1" } }), undefined, [])).toEqual([]);
  });
});

describe("onRejected (AC17)", () => {
  const list = [makeTask({ title: "Local title" }), makeTask({ id: "t2" })];

  it("403: the list is kept, the notice names the task, the project is marked for refresh", () => {
    const out = onRejected(list, change(), new ApiError("forbidden", 403), []);
    expect(out.list).toEqual(list);
    expect(out.notice).toEqual({ kind: "update", taskTitle: "Local title", reason: "forbidden" });
    expect(out.refreshProjectId).toBe("p1");
  });

  it("404: the task is removed from the list", () => {
    const out = onRejected(list, change(), new ApiError("not_found", 404), []);
    expect(out.list.map((t) => t.id)).toEqual(["t2"]);
    expect(out.notice).toEqual({ kind: "update", taskTitle: "Local title", reason: "not_found" });
  });

  it("falls back to the title in the change when the task is not cached (refused create)", () => {
    const out = onRejected([], change({ kind: "create", data: { projectId: "p1", title: "Brand new" } }), new ApiError("validation_failed", 400), []);
    expect(out.notice).toEqual({ kind: "create", taskTitle: "Brand new", reason: "invalid" });
  });

  it("no title anywhere: taskTitle is null", () => {
    const out = onRejected([], change({ kind: "delete", data: { projectId: "p1" } }), new ApiError("forbidden", 403), []);
    expect(out.notice.taskTitle).toBeNull();
  });

  it("409 is a conflict", () => {
    expect(onRejected(list, change(), new ApiError("id_conflict", 409), []).notice.reason).toBe("conflict");
  });
});

describe("noticeKeys", () => {
  it("uses tasks.* headlines and says a refused create could not be created", () => {
    expect(noticeKeys({ kind: "update", taskTitle: "A", reason: "forbidden" })).toEqual({
      headline: "tasks.rejected",
      reason: "errors.forbidden",
    });
    expect(noticeKeys({ kind: "create", taskTitle: "A", reason: "forbidden" }).headline).toBe("tasks.rejectedCreate");
    expect(noticeKeys({ kind: "delete", taskTitle: null, reason: "not_found" }).headline).toBe("tasks.rejectedNoTitle");
    expect(noticeKeys({ kind: "create", taskTitle: null, reason: "invalid" }).headline).toBe("tasks.rejectedCreateNoTitle");
  });
});
