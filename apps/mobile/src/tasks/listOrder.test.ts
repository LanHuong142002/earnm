import { describe, expect, it } from "vitest";

import { orderTasks } from "./listOrder";
import type { Task } from "./types";

const now = new Date(2026, 10, 12, 10, 0, 0);

function task(id: string, patch: Partial<Task>): Task {
  return {
    id,
    projectId: "p",
    title: id,
    description: "",
    status: "todo",
    dueDate: null,
    dueTime: null,
    assignees: [],
    createdById: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...patch,
  };
}
const ids = (list: Task[]) => list.map((t) => t.id);

describe("orderTasks", () => {
  it("orders overdue, due today, due later, no date; done apart", () => {
    const list = [
      task("none", {}),
      task("later", { dueDate: "2026-11-20" }),
      task("today", { dueDate: "2026-11-12" }),
      task("overdue", { dueDate: "2026-11-10" }),
      task("finished", { status: "done", dueDate: "2026-11-09" }),
    ];
    const { open, done } = orderTasks(list, now);
    expect(ids(open)).toEqual(["overdue", "today", "later", "none"]);
    expect(ids(done)).toEqual(["finished"]);
  });
  it("overdue timed task today comes before a date-only task today", () => {
    const list = [
      task("dateOnly", { dueDate: "2026-11-12" }),
      task("passed", { dueDate: "2026-11-12", dueTime: "08:00" }),
      task("evening", { dueDate: "2026-11-12", dueTime: "18:00" }),
    ];
    expect(ids(orderTasks(list, now).open)).toEqual(["passed", "evening", "dateOnly"]);
  });
  it("breaks ties on the same due date by creation time", () => {
    const list = [
      task("new", { dueDate: "2026-11-14", createdAt: "2026-11-05T00:00:00.000Z" }),
      task("old", { dueDate: "2026-11-14", createdAt: "2026-11-02T00:00:00.000Z" }),
      task("noneNew", { createdAt: "2026-11-06T00:00:00.000Z" }),
      task("noneOld", { createdAt: "2026-11-03T00:00:00.000Z" }),
    ];
    expect(ids(orderTasks(list, now).open)).toEqual(["old", "new", "noneOld", "noneNew"]);
  });
  it("does not mutate the input and handles empty lists", () => {
    const list = [task("b", { dueDate: "2026-11-14" }), task("a", { dueDate: "2026-11-13" })];
    orderTasks(list, now);
    expect(ids(list)).toEqual(["b", "a"]);
    expect(orderTasks([], now)).toEqual({ open: [], done: [] });
  });
});
