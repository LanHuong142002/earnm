import { describe, expect, it } from "vitest";

import { countNotDone, visibleTasks } from "./counts";
import { DEFAULT_FILTERS } from "./filters";
import { makeTask } from "./fixtures";

describe("countNotDone", () => {
  it("counts to do and doing, not done", () => {
    const list = [
      makeTask({ id: "a", status: "todo" }),
      makeTask({ id: "b", status: "doing" }),
      makeTask({ id: "c", status: "done" }),
    ];
    expect(countNotDone(list)).toBe(2);
    expect(countNotDone([])).toBe(0);
  });
});

describe("visibleTasks", () => {
  const now = new Date(2026, 10, 12, 10, 0, 0);
  const list = [
    makeTask({ id: "a", status: "todo", createdAt: "2026-11-01T00:00:00.000Z" }),
    makeTask({ id: "d", status: "done", createdAt: "2026-11-02T00:00:00.000Z" }),
    makeTask({ id: "b", status: "doing", createdAt: "2026-11-03T00:00:00.000Z" }),
  ];
  const ids = (l: { id: string }[]) => l.map((t) => t.id);

  it("status All: open tasks, and the done ones apart for the closed section", () => {
    const v = visibleTasks(list, DEFAULT_FILTERS, "me", now);
    expect(ids(v.open)).toEqual(["a", "b"]);
    expect(ids(v.done)).toEqual(["d"]);
    expect(v.total).toBe(3);
  });

  it("status Done: done tasks are listed in the main list, with no separate section", () => {
    const v = visibleTasks(list, { ...DEFAULT_FILTERS, status: "done" }, "me", now);
    expect(ids(v.open)).toEqual(["d"]);
    expect(v.done).toEqual([]);
  });

  it("other filters apply before the split", () => {
    const v = visibleTasks(list, { ...DEFAULT_FILTERS, status: "doing" }, "me", now);
    expect(ids(v.open)).toEqual(["b"]);
    expect(v.total).toBe(1);
  });
});
