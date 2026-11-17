import { describe, expect, it } from "vitest";

import {
  barPercent,
  canAddChecklist,
  canAddItem,
  checklistSummary,
  editItemOutcome,
  newItemOutcome,
} from "./checklistView";

describe("checklistSummary", () => {
  it("is null when no checklist has an item", () => {
    expect(checklistSummary({ checklists: [{ items: [] }] })).toBeNull();
    expect(checklistSummary({ checklists: [] })).toBeNull();
  });
  it("counts done items across all checklists", () => {
    const items = (...d: boolean[]) => d.map((done) => ({ done }));
    expect(checklistSummary({ checklists: [{ items: items(true, true, false) }, { items: items(true, false) }] })).toEqual({
      done: 3,
      total: 5,
    });
  });
});

describe("barPercent", () => {
  it("is 0 without items and rounds otherwise", () => {
    expect(barPercent(null)).toBe(0);
    expect(barPercent({ done: 2, total: 3 })).toBe(67);
    expect(barPercent({ done: 3, total: 3 })).toBe(100);
  });
});

describe("limits", () => {
  it("allows a checklist below 10 and an item below 50", () => {
    expect(canAddChecklist(9)).toBe(true);
    expect(canAddChecklist(10)).toBe(false);
    expect(canAddItem(49)).toBe(true);
    expect(canAddItem(50)).toBe(false);
  });
});

describe("newItemOutcome", () => {
  it("adds trimmed text on Return and stays open", () => {
    expect(newItemOutcome("  Mua sả ", "submit")).toEqual({ kind: "add", text: "Mua sả", keepOpen: true });
  });
  it("shows an error for empty text on Return and stays open", () => {
    expect(newItemOutcome("   ", "submit")).toEqual({ kind: "error", error: "tasks.errors.itemTextRequired" });
  });
  it("closes on blur when empty", () => {
    expect(newItemOutcome("", "blur")).toEqual({ kind: "close" });
  });
  it("adds typed text on blur and closes", () => {
    expect(newItemOutcome("Chốt", "blur")).toEqual({ kind: "add", text: "Chốt", keepOpen: false });
  });
  it("reports a too long text", () => {
    expect(newItemOutcome("a".repeat(201), "submit")).toEqual({ kind: "error", error: "tasks.errors.itemTextTooLong" });
  });
});

describe("editItemOutcome", () => {
  it("does nothing when the text is unchanged", () => {
    expect(editItemOutcome("Đào", " Đào ", "submit")).toEqual({ kind: "close" });
  });
  it("saves a changed text", () => {
    expect(editItemOutcome("Đào", "Đào hộp", "blur")).toEqual({ kind: "save", text: "Đào hộp" });
  });
  it("shows an error for empty text on Return and keeps the old text on blur", () => {
    expect(editItemOutcome("Đào", "", "submit")).toEqual({ kind: "error", error: "tasks.errors.itemTextRequired" });
    expect(editItemOutcome("Đào", "", "blur")).toEqual({ kind: "close" });
  });
});
