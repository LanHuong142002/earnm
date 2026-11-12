import { describe, expect, it } from "vitest";

import { taskView } from "./taskRouting";

describe("taskView", () => {
  it("waits while the project list or the local task copy is loading", () => {
    expect(taskView({ projectFound: false, projectsStatus: "loading", tasksReady: true, taskFound: false })).toBe("loading");
    expect(taskView({ projectFound: true, projectsStatus: "ready", tasksReady: false, taskFound: false })).toBe("loading");
  });
  it("shows the task when it is there", () => {
    expect(taskView({ projectFound: true, projectsStatus: "ready", tasksReady: true, taskFound: true })).toBe("ready");
  });
  it("leaves for the task list when the task is gone", () => {
    expect(taskView({ projectFound: true, projectsStatus: "ready", tasksReady: true, taskFound: false })).toBe("leave");
  });
  it("leaves when the project is gone", () => {
    expect(taskView({ projectFound: false, projectsStatus: "ready", tasksReady: true, taskFound: false })).toBe("leave");
  });
});
