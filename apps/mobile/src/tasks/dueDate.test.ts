import { describe, expect, it } from "vitest";

import { formatDue, isDueSoon, isOverdue } from "./dueDate";
import type { Task } from "./types";

// Local-time constructors only: results never depend on the machine's time zone.
const now = new Date(2026, 10, 12, 10, 0, 0); // Thu 12 Nov 2026, 10:00 local

function task(patch: Partial<Task>): Task {
  return {
    id: "t",
    projectId: "p",
    title: "T",
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

describe("isOverdue", () => {
  it("yesterday is overdue", () => {
    expect(isOverdue(task({ dueDate: "2026-11-11" }), now)).toBe(true);
  });
  it("today without a time is not overdue (counts until end of day)", () => {
    expect(isOverdue(task({ dueDate: "2026-11-12" }), now)).toBe(false);
  });
  it("today with a time already passed is overdue, a later time is not", () => {
    expect(isOverdue(task({ dueDate: "2026-11-12", dueTime: "09:59" }), now)).toBe(true);
    expect(isOverdue(task({ dueDate: "2026-11-12", dueTime: "10:01" }), now)).toBe(false);
  });
  it("no date and done tasks are never overdue", () => {
    expect(isOverdue(task({}), now)).toBe(false);
    expect(isOverdue(task({ dueDate: "2026-11-01", status: "done" }), now)).toBe(false);
  });
});

describe("isDueSoon", () => {
  it("counts yesterday, today and +3 days", () => {
    expect(isDueSoon(task({ dueDate: "2026-11-11" }), now)).toBe(true);
    expect(isDueSoon(task({ dueDate: "2026-11-12" }), now)).toBe(true);
    expect(isDueSoon(task({ dueDate: "2026-11-15" }), now)).toBe(true);
    expect(isDueSoon(task({ dueDate: "2026-11-15", dueTime: "23:59" }), now)).toBe(true);
  });
  it("does not count +4 days", () => {
    expect(isDueSoon(task({ dueDate: "2026-11-16" }), now)).toBe(false);
    expect(isDueSoon(task({ dueDate: "2026-11-16", dueTime: "00:00" }), now)).toBe(false);
  });
  it("does not count done tasks or tasks with no date", () => {
    expect(isDueSoon(task({ dueDate: "2026-11-12", status: "done" }), now)).toBe(false);
    expect(isDueSoon(task({}), now)).toBe(false);
  });
  it("works across a month boundary", () => {
    const end = new Date(2026, 10, 29, 12, 0, 0);
    expect(isDueSoon(task({ dueDate: "2026-12-02" }), end)).toBe(true);
    expect(isDueSoon(task({ dueDate: "2026-12-03" }), end)).toBe(false);
  });
});

describe("formatDue", () => {
  const en: Record<string, string> = {
    "tasks.weekday.5": "Fri",
    "tasks.month.11": "Nov",
  };
  const vi: Record<string, string> = {
    "tasks.weekday.5": "T6",
    "tasks.month.11": "Thg 11",
  };
  const tEn = (k: string) => en[k] ?? k;
  const tVi = (k: string) => vi[k] ?? k;

  it("formats English with a time", () => {
    expect(formatDue("2026-11-13", "14:30", "en", tEn)).toBe("Fri, 13 Nov · 14:30");
  });
  it("formats Vietnamese with a time", () => {
    expect(formatDue("2026-11-13", "14:30", "vi", tVi)).toBe("T6, 13/11 · 14:30");
  });
  it("omits the time part when there is no time", () => {
    expect(formatDue("2026-11-13", null, "en", tEn)).toBe("Fri, 13 Nov");
    expect(formatDue("2026-11-13", null, "vi", tVi)).toBe("T6, 13/11");
  });
});
