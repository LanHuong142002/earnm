import { describe, expect, it } from "vitest";

import { labelSummary, resolveLabels, splitChips } from "./labelDisplay";
import type { Label } from "./types";

const labels: Label[] = [
  { id: "a", name: "Bug", colour: "red" },
  { id: "b", name: "Docs", colour: "blue" },
  { id: "c", name: "Ops", colour: "gray" },
  { id: "d", name: "UX", colour: "teal" },
];

describe("resolveLabels", () => {
  it("keeps the task's order and skips unknown ids", () => {
    expect(resolveLabels(["b", "zzz", "a"], labels).map((l) => l.id)).toEqual(["b", "a"]);
  });
});

describe("splitChips", () => {
  it("shows up to 3 and counts the rest", () => {
    expect(splitChips(labels)).toEqual({ shown: labels.slice(0, 3), extra: 1 });
  });
  it("has no extra with 3 or fewer", () => {
    expect(splitChips(labels.slice(0, 3)).extra).toBe(0);
    expect(splitChips([])).toEqual({ shown: [], extra: 0 });
  });
});

describe("labelSummary", () => {
  it("is null when no chosen label is known", () => {
    expect(labelSummary([], labels)).toBeNull();
    expect(labelSummary(["gone"], labels)).toBeNull();
  });
  it("joins the chosen names in project order", () => {
    expect(labelSummary(["c", "a"], labels)).toBe("Bug, Ops");
  });
});
