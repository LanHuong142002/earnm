import { describe, expect, it } from "vitest";

import { ApiError } from "../lib/api";
import type { Change } from "../sync/queue";
import type { Project } from "./api";
import { onApplied, onRejected } from "./outcomes";

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

describe("onRejected reasons", () => {
  it("maps 409 to conflict and other codes to invalid", () => {
    expect(onRejected([A], change("create", "a"), new ApiError("id_conflict", 409), []).notice.reason).toBe("conflict");
    expect(onRejected([A], change("create", "a"), new ApiError("bad_request", 400), []).notice.reason).toBe("invalid");
  });
});
