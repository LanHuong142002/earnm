import { describe, expect, it } from "vitest";

import { checklistProgress, taskProgress } from "./progress";
import type { Checklist } from "./types";

const list = (id: string, done: boolean[]): Checklist => ({
  id,
  name: id,
  createdAt: "2026-11-01T00:00:00.000Z",
  items: done.map((d, i) => ({ id: id + i, text: "x", done: d, createdAt: "2026-11-01T00:00:00.000Z" })),
});

describe("progress", () => {
  it("is null with no items", () => {
    expect(checklistProgress(list("a", []))).toBeNull();
    expect(taskProgress({ checklists: [] })).toBeNull();
    expect(taskProgress({ checklists: [list("a", []), list("b", [])] })).toBeNull();
  });
  it("counts 3 of 7 across two checklists", () => {
    const a = list("a", [true, true, false]);
    const b = list("b", [true, false, false, false]);
    expect(checklistProgress(a)).toEqual({ done: 2, total: 3 });
    expect(checklistProgress(b)).toEqual({ done: 1, total: 4 });
    expect(taskProgress({ checklists: [a, b] })).toEqual({ done: 3, total: 7 });
  });
  it("skips an empty checklist", () => {
    expect(taskProgress({ checklists: [list("a", []), list("b", [true])] })).toEqual({ done: 1, total: 1 });
  });
});
