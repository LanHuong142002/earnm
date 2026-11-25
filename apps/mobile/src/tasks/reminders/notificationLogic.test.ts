import { describe, expect, it } from "vitest";

import {
  activityEventIds,
  easProjectId,
  permissionFromResponse,
  shouldAskAfterSave,
  showPermissionNotice,
  tapDestination,
  tapFound,
  tapTarget,
} from "./notificationLogic";

describe("permissionFromResponse", () => {
  it("maps the system answer to granted, denied or undetermined", () => {
    expect(permissionFromResponse({ status: "granted" })).toBe("granted");
    expect(permissionFromResponse({ status: "denied" })).toBe("denied");
    expect(permissionFromResponse({ status: "undetermined" })).toBe("undetermined");
    expect(permissionFromResponse({ status: "something else" })).toBe("undetermined");
  });
});

describe("shouldAskAfterSave", () => {
  it("asks only while permission is undetermined (R15)", () => {
    expect(shouldAskAfterSave("undetermined")).toBe(true);
    expect(shouldAskAfterSave("granted")).toBe(false);
    expect(shouldAskAfterSave("denied")).toBe(false);
  });
});

describe("showPermissionNotice", () => {
  it("shows the denied notice only when notifications are off and there is a reminder to be missed (R25)", () => {
    expect(showPermissionNotice("denied", 2)).toBe(true);
    expect(showPermissionNotice("denied", 0)).toBe(false);
    expect(showPermissionNotice("granted", 2)).toBe(false);
    expect(showPermissionNotice("undetermined", 2)).toBe(false);
    expect(showPermissionNotice(null, 2)).toBe(false);
  });
});

describe("easProjectId", () => {
  it("reads the EAS project id and ignores anything else", () => {
    expect(easProjectId({ eas: { projectId: "abc" } })).toBe("abc");
    expect(easProjectId({ eas: { projectId: "" } })).toBeNull();
    expect(easProjectId({ eas: {} })).toBeNull();
    expect(easProjectId({})).toBeNull();
    expect(easProjectId(undefined)).toBeNull();
    expect(easProjectId({ eas: { projectId: 5 } })).toBeNull();
  });
});

describe("tapTarget", () => {
  it("reads the project and task a notification opens", () => {
    expect(tapTarget({ projectId: "p1", taskId: "t1" })).toEqual({ type: "task", projectId: "p1", taskId: "t1" });
  });
  it("is null for a notification that is not ours", () => {
    expect(tapTarget(null)).toBeNull();
    expect(tapTarget({})).toBeNull();
    expect(tapTarget({ projectId: "p1" })).toBeNull();
    expect(tapTarget({ projectId: "", taskId: "t1" })).toBeNull();
    expect(tapTarget({ projectId: 1, taskId: "t1" })).toBeNull();
  });
});

describe("tapDestination", () => {
  const target = { type: "task", projectId: "p1", taskId: "t1" } as const;
  it("opens the task when it is in the cache", () => {
    expect(tapDestination(target, true)).toEqual({ pathname: "/projects/[id]/tasks/[taskId]", params: { id: "p1", taskId: "t1" } });
  });
  it("opens the project list, without an error, when the task is gone (R17)", () => {
    expect(tapDestination(target, false)).toEqual({ pathname: "/projects" });
  });
});

describe("tapTarget for activity pushes", () => {
  const activity = (target: unknown) => ({ kind: "activity", projectId: "p1", target, eventIds: ["e1"] });
  it("reads a task, idea, members or project target", () => {
    expect(tapTarget(activity({ type: "task", taskId: "t1" }))).toEqual({ type: "task", projectId: "p1", taskId: "t1" });
    expect(tapTarget(activity({ type: "idea", ideaId: "i1" }))).toEqual({ type: "idea", projectId: "p1", ideaId: "i1" });
    expect(tapTarget(activity({ type: "members" }))).toEqual({ type: "members", projectId: "p1" });
    expect(tapTarget(activity({ type: "project" }))).toEqual({ type: "project", projectId: "p1" });
  });
  it("is null for malformed activity data", () => {
    expect(tapTarget(activity(undefined))).toBeNull();
    expect(tapTarget(activity({ type: "task" }))).toBeNull();
    expect(tapTarget(activity({ type: "idea", ideaId: "" }))).toBeNull();
    expect(tapTarget(activity({ type: "other" }))).toBeNull();
    expect(tapTarget({ kind: "activity", target: { type: "project" } })).toBeNull();
    expect(tapTarget({ kind: "activity", projectId: "", target: { type: "project" } })).toBeNull();
  });
});

describe("activityEventIds", () => {
  it("reads the event ids, else an empty list", () => {
    expect(activityEventIds({ kind: "activity", eventIds: ["a", "b"] })).toEqual(["a", "b"]);
    expect(activityEventIds({ kind: "activity", eventIds: ["a", 2] })).toEqual([]);
    expect(activityEventIds({ kind: "activity" })).toEqual([]);
    expect(activityEventIds({ projectId: "p1", taskId: "t1" })).toEqual([]);
    expect(activityEventIds(null)).toEqual([]);
  });
});

describe("tapDestination for activity targets", () => {
  it("opens the idea, members, or project screen", () => {
    expect(tapDestination({ type: "idea", projectId: "p1", ideaId: "i1" }, true)).toEqual({
      pathname: "/projects/[id]/ideas/[ideaId]",
      params: { id: "p1", ideaId: "i1" },
    });
    expect(tapDestination({ type: "members", projectId: "p1" }, true)).toEqual({ pathname: "/projects/[id]/members", params: { id: "p1" } });
    expect(tapDestination({ type: "project", projectId: "p1" }, true)).toEqual({ pathname: "/projects/[id]", params: { id: "p1" } });
  });
  it("opens the project list when the target is gone or the person is not a member", () => {
    expect(tapDestination({ type: "idea", projectId: "p1", ideaId: "i1" }, false)).toEqual({ pathname: "/projects" });
    expect(tapDestination({ type: "members", projectId: "p1" }, false)).toEqual({ pathname: "/projects" });
    expect(tapDestination({ type: "project", projectId: "p1" }, false)).toEqual({ pathname: "/projects" });
  });
});

describe("tapFound", () => {
  const lookups = { isMember: (id: string) => id === "p1", hasTask: (_p: string, t: string) => t === "t1", hasIdea: (_p: string, i: string) => i === "i1" };
  it("needs the task or idea itself, or membership for the members and project screens", () => {
    expect(tapFound({ type: "task", projectId: "p1", taskId: "t1" }, lookups)).toBe(true);
    expect(tapFound({ type: "task", projectId: "p1", taskId: "x" }, lookups)).toBe(false);
    expect(tapFound({ type: "idea", projectId: "p1", ideaId: "i1" }, lookups)).toBe(true);
    expect(tapFound({ type: "idea", projectId: "p1", ideaId: "x" }, lookups)).toBe(false);
    expect(tapFound({ type: "members", projectId: "p1" }, lookups)).toBe(true);
    expect(tapFound({ type: "project", projectId: "p2" }, lookups)).toBe(false);
  });
});
