import { describe, expect, it } from "vitest";

import { LABEL_COLOURS, labelFormState, toggleFilterLabel, toggleTaskLabel } from "./labelSheets";
import type { Label } from "./types";

const labels: Label[] = [
  { id: "a", name: "Pha chế", colour: "green" },
  { id: "b", name: "Gấp", colour: "red" },
];

describe("toggleTaskLabel", () => {
  it("adds an unselected label", () => {
    expect(toggleTaskLabel(["a"], "b")).toEqual({ ids: ["a", "b"], limit: false });
  });
  it("removes a selected label", () => {
    expect(toggleTaskLabel(["a", "b"], "a")).toEqual({ ids: ["b"], limit: false });
  });
  it("refuses a new label at 10 and says so", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `x${i}`);
    expect(toggleTaskLabel(ten, "new")).toEqual({ ids: ten, limit: true });
  });
  it("keeps an id the phone does not know in the set it sends", () => {
    expect(toggleTaskLabel(["unknown", "a"], "b").ids).toEqual(["unknown", "a", "b"]);
    expect(toggleTaskLabel(["unknown", "a"], "a").ids).toEqual(["unknown"]);
  });
  it("counts unknown ids toward the 10-label limit", () => {
    const ids = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9", "a"];
    expect(toggleTaskLabel(ids, "b")).toEqual({ ids, limit: true });
  });
  it("still removes a label when at 10", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `x${i}`);
    expect(toggleTaskLabel(ten, "x3").ids).toHaveLength(9);
  });
});

describe("toggleFilterLabel", () => {
  it("adds and removes", () => {
    expect(toggleFilterLabel([], "a")).toEqual(["a"]);
    expect(toggleFilterLabel(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("labelFormState", () => {
  it("is invalid and quiet when the name is empty and untouched", () => {
    expect(labelFormState("", labels, undefined)).toEqual({ valid: false, error: null, name: null });
  });
  it("reports required once touched", () => {
    expect(labelFormState("  ", labels, undefined, true).error).toBe("tasks.errors.labelNameRequired");
  });
  it("reports too long", () => {
    expect(labelFormState("x".repeat(31), labels, undefined).error).toBe("tasks.errors.labelNameTooLong");
  });
  it("reports a duplicate ignoring case and spaces", () => {
    const s = labelFormState(" pha chế ", labels, undefined);
    expect(s).toMatchObject({ valid: false, error: "tasks.labels.duplicate" });
  });
  it("allows the label's own name when editing", () => {
    expect(labelFormState("Pha chế", labels, "a")).toEqual({ valid: true, error: null, name: "Pha chế" });
  });
  it("accepts a fresh name, trimmed", () => {
    expect(labelFormState(" Mới ", labels, undefined)).toEqual({ valid: true, error: null, name: "Mới" });
  });
});

describe("LABEL_COLOURS", () => {
  it("lists the eight colours in the approved order", () => {
    expect(LABEL_COLOURS).toEqual(["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple"]);
  });
});
