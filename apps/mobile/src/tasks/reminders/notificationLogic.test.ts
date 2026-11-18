import { describe, expect, it } from "vitest";

import { easProjectId, permissionFromResponse, shouldAskAfterSave, showPermissionNotice, tapDestination, tapTarget } from "./notificationLogic";

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
    expect(tapTarget({ projectId: "p1", taskId: "t1" })).toEqual({ projectId: "p1", taskId: "t1" });
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
  const target = { projectId: "p1", taskId: "t1" };
  it("opens the task when it is in the cache", () => {
    expect(tapDestination(target, true)).toEqual({ pathname: "/projects/[id]/tasks/[taskId]", params: { id: "p1", taskId: "t1" } });
  });
  it("opens the project list, without an error, when the task is gone (R17)", () => {
    expect(tapDestination(target, false)).toEqual({ pathname: "/projects" });
  });
});
