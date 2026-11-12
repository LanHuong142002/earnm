import type { Task } from "./types";

/** A task as the server returns it; tests override what they care about. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    projectId: "p1",
    title: "Buy paint",
    description: "",
    status: "todo",
    dueDate: null,
    dueTime: null,
    assignees: [],
    createdById: "u1",
    createdAt: "2026-11-01T08:00:00.000Z",
    ...overrides,
  };
}
