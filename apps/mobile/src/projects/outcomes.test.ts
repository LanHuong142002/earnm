import { describe, expect, it } from "vitest";

import { ApiError } from "../lib/api";
import type { Change } from "../sync/queue";
import type { Project } from "./api";
import { noticeKeys, onApplied, onRejected, projectsToDrop, withJoined, withoutProject } from "./outcomes";

const T = "2026-01-01T00:00:00.000Z";
const A: Project = { id: "a", name: "Alpha", description: "", currency: "VND", role: "owner" };
const B: Project = { id: "b", name: "Beta", description: "", currency: "USD", role: "member" };
const change = (kind: Change["kind"], entityId: string, data: Record<string, unknown> = {}): Change => ({
  changeId: `${kind}-${entityId}`, entity: "project", entityId, kind, data, fieldTimes: {}, createdAt: T,
});

describe("onApplied", () => {
  it("puts the server's project in and replays the changes still waiting", () => {
    const local = [{ ...A, name: "Local" }, B];
    const waiting = [change("update", "b", { name: "Later" })];
    const out = onApplied(local, change("update", "a", { name: "Server" }), { ...A, name: "Server" }, waiting);
    expect(out.map((p) => p.name)).toEqual(["Server", "Later"]);
  });
});

describe("onRejected with 403 (AC26)", () => {
  it("sets the notice with the project's name and asks for the server's version", () => {
    const local = [{ ...A, name: "Edited offline" }, B];
    const c = change("update", "a", { name: "Edited offline" });
    const result = onRejected(local, c, new ApiError("forbidden", 403), []);
    expect(result.notice).toEqual({ kind: "update", projectName: "Edited offline", reason: "forbidden" });
    expect(result.needsRefresh).toBe(true);
    // Restoring the server's version is covered end to end in syncCycle.test.ts.
  });

  it("uses the local project's name when the change carries none", () => {
    const result = onRejected([A], change("delete", "a"), new ApiError("forbidden", 403), []);
    expect(result.notice.projectName).toBe("Alpha");
  });
});

describe("onRejected with 404 (AC27)", () => {
  it("removes the project locally and sets the notice", () => {
    const result = onRejected([A, B], change("update", "a", { description: "x" }), new ApiError("not_found", 404), []);
    expect(result.list.map((p) => p.id)).toEqual(["b"]);
    expect(result.notice).toEqual({ kind: "update", projectName: "Alpha", reason: "not_found" });
  });

  it("still shows other waiting changes", () => {
    const result = onRejected([A, B], change("update", "a"), new ApiError("not_found", 404), [
      change("update", "b", { name: "B2" }),
    ]);
    expect(result.list.map((p) => p.name)).toEqual(["B2"]);
  });
});

describe("onRejected naming", () => {
  it("names the project by its known local name, not the new name in the change", () => {
    const result = onRejected([A], change("update", "a", { name: "Renamed" }), new ApiError("forbidden", 403), []);
    expect(result.notice.projectName).toBe("Alpha");
  });

  it("falls back to the change's name when the project is unknown", () => {
    const result = onRejected([], change("create", "z", { name: "Zed" }), new ApiError("bad_request", 400), []);
    expect(result.notice.projectName).toBe("Zed");
  });
});

describe("onRejected reasons", () => {
  it("maps 409 to conflict and other codes to invalid", () => {
    expect(onRejected([A], change("create", "a"), new ApiError("id_conflict", 409), []).notice.reason).toBe("conflict");
    expect(onRejected([A], change("create", "a"), new ApiError("bad_request", 400), []).notice.reason).toBe("invalid");
  });
});

describe("noticeKeys", () => {
  it("says a refused create couldn't be created, never that the project no longer exists", () => {
    const keys = noticeKeys({ kind: "create", projectName: "Zed", reason: "not_found" });
    expect(keys).toEqual({ headline: "projects.rejectedCreate", reason: "errors.create_failed" });
    expect(noticeKeys({ kind: "create", projectName: null, reason: "invalid" }).headline).toBe("projects.rejectedCreateNoName");
  });

  it("keeps the existing wording for updates and deletes", () => {
    expect(noticeKeys({ kind: "update", projectName: "A", reason: "not_found" })).toEqual({
      headline: "projects.rejected",
      reason: "errors.not_found",
    });
    expect(noticeKeys({ kind: "delete", projectName: null, reason: "forbidden" })).toEqual({
      headline: "projects.rejectedNoName",
      reason: "errors.forbidden",
    });
  });
});

describe("projectsToDrop", () => {
  it("returns queued project ids the server no longer lists", () => {
    expect(projectsToDrop(["a"], [change("update", "a"), change("update", "b")])).toEqual(["b"]);
  });

  it("keeps a project that is only queued as a create (not on the server yet)", () => {
    expect(projectsToDrop(["a"], [change("create", "new"), change("update", "gone")])).toEqual(["gone"]);
  });

  it("keeps an id with a create even when other ops for it are queued after the create", () => {
    expect(projectsToDrop([], [change("create", "n"), change("update", "n")])).toEqual([]);
  });

  it("lists each id once and ignores other entities", () => {
    const other = { ...change("update", "x"), entity: "invite" };
    expect(projectsToDrop([], [change("update", "g"), { ...change("delete", "g"), changeId: "d2" }, other])).toEqual(["g"]);
  });

  it("returns nothing when everything queued is on the server", () => {
    expect(projectsToDrop(["a", "b"], [change("update", "a"), change("delete", "b")])).toEqual([]);
  });
});

describe("withJoined", () => {
  it("appends a project that is not in the list, keeping the order", () => {
    expect(withJoined([A], B).map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("replaces a project already in the list at its place (no duplicate)", () => {
    const out = withJoined([A, B], { ...A, name: "Server" });
    expect(out.map((p) => p.name)).toEqual(["Server", "Beta"]);
  });
});

describe("withoutProject", () => {
  it("removes the project by id and keeps the rest in order", () => {
    expect(withoutProject([A, B], "a")).toEqual([B]);
  });
  it("leaves the list alone for an unknown id", () => {
    expect(withoutProject([A, B], "zzz")).toEqual([A, B]);
  });
});
