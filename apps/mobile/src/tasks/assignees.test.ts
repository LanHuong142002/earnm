import { describe, expect, it } from "vitest";

import { assigneeSummary, membersToAssignees, toggleAssignee } from "./assignees";

describe("membersToAssignees", () => {
  it("keeps the id and the display name only", () => {
    expect(
      membersToAssignees([{ userId: "u1", displayName: "An", role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }]),
    ).toEqual([{ id: "u1", displayName: "An" }]);
  });
});

describe("toggleAssignee (R3)", () => {
  it("adds a person who is not chosen", () => {
    expect(toggleAssignee(["a"], "b")).toEqual({ ids: ["a", "b"], tooMany: false });
  });
  it("removes a person who is chosen", () => {
    expect(toggleAssignee(["a", "b"], "a")).toEqual({ ids: ["b"], tooMany: false });
  });
  it("refuses a 21st person and says so", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `u${i}`);
    expect(toggleAssignee(twenty, "x")).toEqual({ ids: twenty, tooMany: true });
  });
  it("still removes someone when at the limit", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `u${i}`);
    expect(toggleAssignee(twenty, "u3").ids).toHaveLength(19);
  });
});

describe("assigneeSummary", () => {
  const people = [
    { id: "a", displayName: "Nguyen An" },
    { id: "b", displayName: "Binh" },
    { id: "c", displayName: "Chi Le" },
  ];
  it("lists chosen first names in the list's order", () => {
    expect(assigneeSummary(["c", "a"], people)).toBe("Nguyen, Chi");
  });
  it("is empty for nobody", () => {
    expect(assigneeSummary([], people)).toBe("");
  });
  it("skips ids that are not in the list", () => {
    expect(assigneeSummary(["zzz", "b"], people)).toBe("Binh");
  });
});
