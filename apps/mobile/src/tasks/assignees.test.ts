import { describe, expect, it } from "vitest";

import { assigneeSummary, buildAssigneeOptions, membersToAssignees, toggleAssignee } from "./assignees";

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

describe("toggleAssignee with someone who cannot be added (R27)", () => {
  it("does not add a person marked not addable", () => {
    expect(toggleAssignee(["a"], "gone", false)).toEqual({ ids: ["a"], tooMany: false });
  });
  it("still removes that person", () => {
    expect(toggleAssignee(["a", "gone"], "gone", false)).toEqual({ ids: ["a"], tooMany: false });
  });
});

describe("buildAssigneeOptions (R27)", () => {
  const member = (userId: string, displayName: string) => ({
    userId,
    displayName,
    role: "member" as const,
    joinedAt: "2026-01-01T00:00:00.000Z",
  });
  const known = [
    { id: "me", displayName: "Me" },
    { id: "old", displayName: "Old" },
  ];

  it("offers only the current members once the list is known", () => {
    const options = buildAssigneeOptions({ members: [member("me", "Me"), member("u2", "Binh")], known, selectedIds: [] });
    expect(options).toEqual([
      { id: "me", displayName: "Me", former: false },
      { id: "u2", displayName: "Binh", former: false },
    ]);
  });

  it("keeps an assigned former member, marked, after the current ones", () => {
    const options = buildAssigneeOptions({ members: [member("me", "Me")], known, selectedIds: ["old", "me"] });
    expect(options).toEqual([
      { id: "me", displayName: "Me", former: false },
      { id: "old", displayName: "Old", former: true },
    ]);
  });

  it("drops a former member once unticked", () => {
    const options = buildAssigneeOptions({ members: [member("me", "Me")], known, selectedIds: [] });
    expect(options.map((o) => o.id)).toEqual(["me"]);
  });

  it("skips an assigned former member whose name is unknown", () => {
    const options = buildAssigneeOptions({ members: [member("me", "Me")], known, selectedIds: ["ghost"] });
    expect(options.map((o) => o.id)).toEqual(["me"]);
  });

  it("uses the server's name for a current member", () => {
    const options = buildAssigneeOptions({ members: [member("me", "Me Renamed")], known, selectedIds: [] });
    expect(options[0].displayName).toBe("Me Renamed");
  });

  it("falls back to what the phone knows when no member list was ever fetched", () => {
    const options = buildAssigneeOptions({ members: null, known, selectedIds: ["old"] });
    expect(options).toEqual([
      { id: "me", displayName: "Me", former: false },
      { id: "old", displayName: "Old", former: false },
    ]);
  });

  // Found at QA: with the profile not loaded the picker was empty (no member list, nobody known).
  it("always lists the signed-in person, even with no member list and nobody else known", () => {
    const options = buildAssigneeOptions({ members: null, known: [], selectedIds: [], me: { id: "me", displayName: "Me" } });
    expect(options).toEqual([{ id: "me", displayName: "Me", former: false }]);
  });

  it("leaves the signed-in person out when the loaded member list does not name them", () => {
    const options = buildAssigneeOptions({
      members: [member("u2", "Binh")],
      known,
      selectedIds: [],
      me: { id: "me", displayName: "Me" },
    });
    expect(options).toEqual([{ id: "u2", displayName: "Binh", former: false }]);
  });

  it("does not list the signed-in person twice", () => {
    const options = buildAssigneeOptions({
      members: [member("u2", "Binh"), member("me", "Me")],
      known,
      selectedIds: [],
      me: { id: "me", displayName: "Me" },
    });
    expect(options.map((o) => o.id)).toEqual(["u2", "me"]);
  });

  it("with a loaded list, lists me only when the list includes me, in the server's order", () => {
    const me = { id: "me", displayName: "Me" };
    const withoutMe = buildAssigneeOptions({ members: [member("u2", "Binh")], known, selectedIds: [], me });
    expect(withoutMe.map((o) => o.id)).toEqual(["u2"]);
    const withMe = buildAssigneeOptions({
      members: [member("u2", "Binh"), member("me", "Me")],
      known,
      selectedIds: [],
      me,
    });
    expect(withMe.map((o) => o.id)).toEqual(["u2", "me"]);
  });
  it("with no list ever loaded, still lists me first", () => {
    const me = { id: "me", displayName: "Me" };
    const options = buildAssigneeOptions({ members: null, known: [{ id: "u2", displayName: "Binh" }], selectedIds: [], me });
    expect(options.map((o) => o.id)).toEqual(["me", "u2"]);
  });
});
