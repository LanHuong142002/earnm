import { describe, expect, it } from "vitest";

import type { ActivityItem } from "./api";
import { appendPage, hasUnreadAfter, markAllRead, markRead, unreadIds } from "./list";

const row = (id: string, read = false): ActivityItem => ({
  id,
  type: "comment",
  actorName: "Lan",
  subjectTitle: "x",
  projectId: "p",
  projectName: "P",
  taskId: "t",
  ideaId: null,
  memberId: null,
  memberName: null,
  occurredAt: "2026-11-25T08:00:00.000Z",
  read,
});

describe("activity list", () => {
  it("marks only the named rows read", () => {
    const next = markRead([row("a"), row("b"), row("c", true)], ["b", "zzz"]);
    expect(next.map((i) => i.read)).toEqual([false, true, true]);
  });

  it("marks every row read and lists the unread ones", () => {
    const rows = [row("a"), row("b", true), row("c")];
    expect(unreadIds(rows)).toEqual(["a", "c"]);
    expect(unreadIds(markAllRead(rows))).toEqual([]);
  });

  it("adds a page after the rows shown and drops a row seen twice", () => {
    const next = appendPage([row("a"), row("b")], { items: [row("b"), row("c")], nextCursor: null });
    expect(next.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the dot while rows are unread, or the server says so and more rows are to load", () => {
    expect(hasUnreadAfter([row("a")], null, false)).toBe(true);
    expect(hasUnreadAfter([row("a", true)], null, true)).toBe(false);
    expect(hasUnreadAfter([row("a", true)], "next", true)).toBe(true);
    expect(hasUnreadAfter([row("a", true)], "next", false)).toBe(false);
  });
});
