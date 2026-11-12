import { describe, expect, it } from "vitest";

import { canDeleteTask } from "./permissions";

describe("canDeleteTask", () => {
  it("the creator can delete, as owner or member", () => {
    expect(canDeleteTask({ createdById: "me" }, "me", "member")).toBe(true);
    expect(canDeleteTask({ createdById: "me" }, "me", "owner")).toBe(true);
  });
  it("an owner can delete anyone's task", () => {
    expect(canDeleteTask({ createdById: "x" }, "me", "owner")).toBe(true);
  });
  it("a member who did not create it cannot", () => {
    expect(canDeleteTask({ createdById: "x" }, "me", "member")).toBe(false);
  });
  it("a task with no creator can be deleted only by an owner", () => {
    expect(canDeleteTask({ createdById: null }, "me", "owner")).toBe(true);
    expect(canDeleteTask({ createdById: null }, "me", "member")).toBe(false);
  });
});
