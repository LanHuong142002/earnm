import { describe, expect, it } from "vitest";

import { validateTaskInput, type TaskInput } from "./validate";

const base: TaskInput = {
  title: "Buy flour",
  description: "",
  status: "todo",
  dueDate: null,
  dueTime: null,
  assigneeIds: [],
};

describe("validateTaskInput", () => {
  it("accepts a title only and trims text", () => {
    const r = validateTaskInput({ ...base, title: "  Buy flour  ", description: "  hi " });
    expect(r).toEqual({
      ok: true,
      value: { ...base, title: "Buy flour", description: "hi", status: "todo" },
    });
  });
  it("title: empty after trim is required, 121 is too long, 120 is fine", () => {
    expect(validateTaskInput({ ...base, title: "   " })).toMatchObject({
      ok: false,
      errors: { title: "tasks.errors.titleRequired" },
    });
    expect(validateTaskInput({ ...base, title: "a".repeat(121) })).toMatchObject({
      ok: false,
      errors: { title: "tasks.errors.titleTooLong" },
    });
    expect(validateTaskInput({ ...base, title: "a".repeat(120) }).ok).toBe(true);
  });
  it("description: 2000 ok, 2001 too long", () => {
    expect(validateTaskInput({ ...base, description: "a".repeat(2000) }).ok).toBe(true);
    expect(validateTaskInput({ ...base, description: "a".repeat(2001) })).toMatchObject({
      ok: false,
      errors: { description: "tasks.errors.descriptionTooLong" },
    });
  });
  it("status must be known", () => {
    expect(validateTaskInput({ ...base, status: "later" })).toMatchObject({
      ok: false,
      errors: { status: "tasks.errors.statusInvalid" },
    });
    for (const s of ["todo", "doing", "done"]) expect(validateTaskInput({ ...base, status: s }).ok).toBe(true);
  });
  it("due date and time", () => {
    expect(validateTaskInput({ ...base, dueDate: "2026-11-14", dueTime: "14:30" }).ok).toBe(true);
    expect(validateTaskInput({ ...base, dueDate: "2026-11-14" }).ok).toBe(true);
    for (const dueDate of ["1899-12-31", "0001-01-01", "10000-01-01"])
      expect(validateTaskInput({ ...base, dueDate })).toMatchObject({ ok: false, errors: { dueDate: "tasks.errors.dueDateInvalid" } });
    expect(validateTaskInput({ ...base, dueDate: "1900-01-01" }).ok).toBe(true);
    expect(validateTaskInput({ ...base, dueDate: "9999-12-31" }).ok).toBe(true);
    expect(validateTaskInput({ ...base, dueDate: "2026-02-30" })).toMatchObject({
      ok: false,
      errors: { dueDate: "tasks.errors.dueDateInvalid" },
    });
    expect(validateTaskInput({ ...base, dueDate: "2026-11-14", dueTime: "24:00" })).toMatchObject({
      ok: false,
      errors: { dueTime: "tasks.errors.dueTimeInvalid" },
    });
    expect(validateTaskInput({ ...base, dueTime: "14:30" })).toMatchObject({
      ok: false,
      errors: { dueTime: "tasks.errors.dueTimeNeedsDate" },
    });
  });
  it("assignees: 20 ok, 21 too many, duplicates refused", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);
    expect(validateTaskInput({ ...base, assigneeIds: ids(20) }).ok).toBe(true);
    expect(validateTaskInput({ ...base, assigneeIds: ids(21) })).toMatchObject({
      ok: false,
      errors: { assignees: "tasks.errors.assigneesTooMany" },
    });
    expect(validateTaskInput({ ...base, assigneeIds: ["a", "a"] })).toMatchObject({
      ok: false,
      errors: { assignees: "tasks.errors.assigneesDuplicate" },
    });
  });
  it("reports several fields at once", () => {
    const r = validateTaskInput({ ...base, title: "", description: "a".repeat(2001) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["description", "title"]);
  });
});
