import { describe, expect, it } from "vitest";

import { canDeleteLabel, canDeleteTask, canEditComment, isInvolved } from "./permissions";

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

describe("canDeleteLabel", () => {
  it("only an owner can delete a label", () => {
    expect(canDeleteLabel("owner")).toBe(true);
    expect(canDeleteLabel("member")).toBe(false);
  });
});

describe("isInvolved", () => {
  const task = { createdById: "creator", assignees: [{ id: "a1", displayName: "A" }] };
  it("the creator and an assignee are involved", () => {
    expect(isInvolved(task, "creator")).toBe(true);
    expect(isInvolved(task, "a1")).toBe(true);
  });
  it("anyone else is not, an Owner included", () => {
    expect(isInvolved(task, "other")).toBe(false);
  });
  it("a task with no creator involves only its assignees", () => {
    expect(isInvolved({ createdById: null, assignees: [] }, "creator")).toBe(false);
    expect(isInvolved({ createdById: null, assignees: task.assignees }, "a1")).toBe(true);
  });
  it("nobody is involved without a signed-in user", () => {
    expect(isInvolved(task, null)).toBe(false);
  });
});

describe("canEditComment", () => {
  it("only the author can edit or delete, an Owner included", () => {
    expect(canEditComment({ author: { id: "me", displayName: "Me" } }, "me")).toBe(true);
    expect(canEditComment({ author: { id: "x", displayName: "X" } }, "me")).toBe(false);
  });
  it("a comment whose author is gone is editable by nobody", () => {
    expect(canEditComment({ author: null }, "me")).toBe(false);
    expect(canEditComment({ author: { id: "me", displayName: "Me" } }, null)).toBe(false);
  });
});
