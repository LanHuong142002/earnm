import { describe, expect, it } from "vitest";

import { applyFilters, DEFAULT_FILTERS } from "./filters";
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

const me = { id: "me", displayName: "Me" };
const other = { id: "o", displayName: "Other" };
const tasks = [
  task("a", { status: "todo", assignees: [me], dueDate: "2026-11-13" }),
  task("b", { status: "doing", assignees: [other], dueDate: "2026-11-12" }),
  task("c", { status: "done", assignees: [me], dueDate: "2026-11-12" }),
  task("d", { status: "todo", dueDate: "2026-11-30" }),
  task("e", { status: "doing", assignees: [me, other] }),
];
const ids = (list: Task[]) => list.map((t) => t.id);

describe("DEFAULT_FILTERS", () => {
  it("has every switch off", () => {
    expect(DEFAULT_FILTERS).toEqual({ status: "all", mine: false, onlyMe: false, dueSoon: false });
  });
});

describe("applyFilters", () => {
  it("default keeps everything", () => {
    expect(ids(applyFilters(tasks, DEFAULT_FILTERS, "me", now))).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("each status alone", () => {
    expect(ids(applyFilters(tasks, { ...DEFAULT_FILTERS, status: "todo" }, "me", now))).toEqual(["a", "d"]);
    expect(ids(applyFilters(tasks, { ...DEFAULT_FILTERS, status: "doing" }, "me", now))).toEqual(["b", "e"]);
    expect(ids(applyFilters(tasks, { ...DEFAULT_FILTERS, status: "done" }, "me", now))).toEqual(["c"]);
  });
  it("my tasks alone", () => {
    expect(ids(applyFilters(tasks, { ...DEFAULT_FILTERS, mine: true }, "me", now))).toEqual(["a", "c", "e"]);
  });
  it("only me keeps tasks where I am the one and only assignee", () => {
    expect(ids(applyFilters(tasks, { ...DEFAULT_FILTERS, onlyMe: true }, "me", now))).toEqual(["a", "c"]);
  });
  it("only me with assigned to me is the same as only me", () => {
    expect(ids(applyFilters(tasks, { ...DEFAULT_FILTERS, mine: true, onlyMe: true }, "me", now))).toEqual(["a", "c"]);
  });
  it("only me never matches unassigned tasks or someone else", () => {
    expect(ids(applyFilters(tasks, { ...DEFAULT_FILTERS, onlyMe: true }, "o", now))).toEqual(["b"]);
  });
  it("due soon alone excludes done and undated", () => {
    expect(ids(applyFilters(tasks, { ...DEFAULT_FILTERS, dueSoon: true }, "me", now))).toEqual(["a", "b"]);
  });
  it("combines all conditions", () => {
    expect(ids(applyFilters(tasks, { ...DEFAULT_FILTERS, status: "todo", mine: true, dueSoon: true }, "me", now))).toEqual(["a"]);
    expect(ids(applyFilters(tasks, { ...DEFAULT_FILTERS, status: "doing", mine: true }, "me", now))).toEqual(["e"]);
    expect(ids(applyFilters(tasks, { ...DEFAULT_FILTERS, status: "done", dueSoon: true }, "me", now))).toEqual([]);
  });
  it("does not mutate the input", () => {
    const copy = [...tasks];
    applyFilters(tasks, { ...DEFAULT_FILTERS, mine: true }, "me", now);
    expect(tasks).toEqual(copy);
  });
});
