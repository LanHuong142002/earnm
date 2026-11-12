import { describe, expect, it } from "vitest";

import { makeTask } from "./fixtures";
import { planTaskCreate, planTaskDelete, planTaskUpdate, withApplied } from "./optimistic";

const NOW = new Date("2026-11-12T09:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const MEMBERS = [
  { id: "u1", displayName: "Lan" },
  { id: "u2", displayName: "Huy" },
];

describe("planTaskCreate", () => {
  const input = { title: "  Paint  ", description: "", status: "todo", dueDate: null, dueTime: null, assigneeIds: [] };

  it("builds a create change with every field and the creator", () => {
    const plan = planTaskCreate({ id: "n1", projectId: "p1", userId: "u1", input, members: MEMBERS, now: NOW });
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.change).toMatchObject({
      entity: "task",
      entityId: "n1",
      kind: "create",
      data: { projectId: "p1", title: "Paint", description: "", status: "todo", due: null, assignees: [], createdById: "u1" },
    });
    expect(plan.change.fieldTimes?.title).toBe(NOW_ISO);
  });

  it("puts due and assignee names in", () => {
    const plan = planTaskCreate({
      id: "n1",
      projectId: "p1",
      userId: "u1",
      members: MEMBERS,
      now: NOW,
      input: { ...input, dueDate: "2026-11-14", dueTime: "14:30", assigneeIds: ["u2"] },
    });
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.change.data.due).toEqual({ date: "2026-11-14", time: "14:30" });
    expect(plan.change.data.assignees).toEqual(["u2"]);
    expect(plan.change.data.assigneeNames).toEqual({ u2: "Huy" });
  });

  it("refuses an invalid input with a message key per field", () => {
    const plan = planTaskCreate({ id: "n1", projectId: "p1", userId: "u1", input: { ...input, title: " " }, members: MEMBERS, now: NOW });
    expect(plan).toEqual({ ok: false, errors: { title: "tasks.errors.titleRequired" } });
  });
});

describe("planTaskUpdate sends only the touched fields, each with its own time", () => {
  const task = makeTask({ dueDate: "2026-11-14", dueTime: "09:00", assignees: [MEMBERS[0]] });

  function changeOf(edit: Parameters<typeof planTaskUpdate>[1]) {
    const plan = planTaskUpdate(task, edit, MEMBERS, NOW);
    if (!plan.ok || !plan.change) throw new Error("expected a change");
    return plan.change;
  }

  it("a rename sends only the title", () => {
    const change = changeOf({ title: " New " });
    expect(change.kind).toBe("update");
    expect(change.entityId).toBe("t1");
    expect(change.data).toEqual({ projectId: "p1", title: "New" });
    expect(change.fieldTimes?.title).toBe(NOW_ISO);
  });

  it("a status change sends only the status", () => {
    expect(changeOf({ status: "done" }).data).toEqual({ projectId: "p1", status: "done" });
  });

  it("a date change keeps the time and sends due as one field", () => {
    expect(changeOf({ dueDate: "2026-11-20" }).data).toEqual({ projectId: "p1", due: { date: "2026-11-20", time: "09:00" } });
  });

  it("clearing the date clears the time: due is null", () => {
    expect(changeOf({ dueDate: null }).data).toEqual({ projectId: "p1", due: null });
  });

  it("clearing only the time keeps the day", () => {
    expect(changeOf({ dueTime: null }).data).toEqual({ projectId: "p1", due: { date: "2026-11-14", time: null } });
  });

  it("assignees are sent as the whole set with their names", () => {
    expect(changeOf({ assigneeIds: ["u1", "u2"] }).data).toEqual({
      projectId: "p1",
      assignees: ["u1", "u2"],
      assigneeNames: { u1: "Lan", u2: "Huy" },
    });
  });

  it("a value equal to the current one is not sent; nothing touched means no change", () => {
    const plan = planTaskUpdate(task, { title: "Buy paint", status: "todo", assigneeIds: ["u1"], dueDate: "2026-11-14" }, MEMBERS, NOW);
    expect(plan).toEqual({ ok: true, change: null });
  });

  it("refuses an invalid edit and sends nothing", () => {
    expect(planTaskUpdate(task, { title: "x".repeat(121) }, MEMBERS, NOW)).toEqual({
      ok: false,
      errors: { title: "tasks.errors.titleTooLong" },
    });
  });

  it("a time on a task with no day is refused", () => {
    expect(planTaskUpdate(makeTask(), { dueTime: "10:00" }, MEMBERS, NOW)).toEqual({
      ok: false,
      errors: { dueTime: "tasks.errors.dueTimeNeedsDate" },
    });
  });
});

describe("planTaskDelete", () => {
  it("carries the project and the title for the notice", () => {
    expect(planTaskDelete(makeTask())).toMatchObject({
      entity: "task",
      entityId: "t1",
      kind: "delete",
      data: { projectId: "p1", title: "Buy paint" },
    });
  });
});

describe("withApplied", () => {
  it("replaces a task by id, appends a new one, removes on delete", () => {
    const list = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    const server = makeTask({ id: "a", title: "From server" });
    const base = { entity: "task", entityId: "a", data: {}, fieldTimes: {}, createdAt: "", changeId: "c" } as const;
    expect(withApplied(list, { ...base, kind: "update" }, server)[0].title).toBe("From server");
    expect(withApplied(list, { ...base, kind: "create" }, makeTask({ id: "z" })).map((t) => t.id)).toEqual(["a", "b", "z"]);
    expect(withApplied(list, { ...base, kind: "delete" }, undefined).map((t) => t.id)).toEqual(["b"]);
  });
});
