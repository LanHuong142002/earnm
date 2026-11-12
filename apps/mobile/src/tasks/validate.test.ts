import { describe, expect, it } from "vitest";

import {
  CHECKLISTS_PER_TASK_MAX,
  isDuplicateLabelName,
  ITEMS_PER_CHECKLIST_MAX,
  LABELS_PER_PROJECT_MAX,
  LABELS_PER_TASK_MAX,
  validateChecklistName,
  validateItemText,
  validateLabelName,
  validateTaskInput,
  type TaskInput,
} from "./validate";

const base: TaskInput = {
  title: "Buy flour",
  description: "",
  status: "todo",
  dueDate: null,
  dueTime: null,
  assigneeIds: [],
};

describe("validateTaskInput", () => {
  it("strips control characters, keeping newline, return and tab in the description", () => {
    const r = validateTaskInput({ ...base, title: "Buy\u0000 fl\nour\u007f\u0085\u009f", description: " a\u0000b\nc\r\n\td\u0001 " });
    expect(r).toEqual({
      ok: true,
      value: { ...base, title: "Buy flour", description: "ab\nc\r\n\td", status: "todo" },
    });
    expect(validateTaskInput({ ...base, title: "\u0000\u0001" })).toEqual({
      ok: false,
      errors: { title: "tasks.errors.titleRequired" },
    });
  });

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

describe("checklist and label text", () => {
  it("accepts the maximum length and refuses one more", () => {
    expect(validateChecklistName("a".repeat(60)).ok).toBe(true);
    expect(validateChecklistName("a".repeat(61))).toEqual({ ok: false, error: "tasks.errors.checklistNameTooLong" });
    expect(validateItemText("a".repeat(200)).ok).toBe(true);
    expect(validateItemText("a".repeat(201))).toEqual({ ok: false, error: "tasks.errors.itemTextTooLong" });
    expect(validateLabelName("a".repeat(30)).ok).toBe(true);
    expect(validateLabelName("a".repeat(31))).toEqual({ ok: false, error: "tasks.errors.labelNameTooLong" });
  });
  it("trims, and refuses empty or control-only text", () => {
    expect(validateLabelName("  Urgent ")).toEqual({ ok: true, value: "Urgent" });
    expect(validateLabelName("  ")).toEqual({ ok: false, error: "tasks.errors.labelNameRequired" });
    expect(validateLabelName("\u0000\u0007")).toEqual({ ok: false, error: "tasks.errors.labelNameRequired" });
    expect(validateChecklistName("")).toEqual({ ok: false, error: "tasks.errors.checklistNameRequired" });
    expect(validateItemText(" ")).toEqual({ ok: false, error: "tasks.errors.itemTextRequired" });
  });
  it("strips control characters inside the text", () => {
    expect(validateItemText("Buy\u0000 flour")).toEqual({ ok: true, value: "Buy flour" });
  });
  it("has the spec's count limits", () => {
    expect([CHECKLISTS_PER_TASK_MAX, ITEMS_PER_CHECKLIST_MAX, LABELS_PER_PROJECT_MAX, LABELS_PER_TASK_MAX]).toEqual([
      10, 50, 50, 10,
    ]);
  });
});

describe("isDuplicateLabelName", () => {
  const labels = [
    { id: "l1", name: "Pha chế" },
    { id: "l2", name: "Urgent" },
  ];
  it("ignores case, spaces and Unicode form", () => {
    expect(isDuplicateLabelName(" PHA CHẾ ", labels)).toBe(true);
    expect(isDuplicateLabelName("Pha ch\u00ea\u0301".toUpperCase(), labels)).toBe(true);
    expect(isDuplicateLabelName("Pha che", labels)).toBe(false);
  });
  it("lets a label keep its own name when renaming", () => {
    expect(isDuplicateLabelName("urgent", labels, "l2")).toBe(false);
    expect(isDuplicateLabelName("urgent", labels, "l1")).toBe(true);
  });
});
