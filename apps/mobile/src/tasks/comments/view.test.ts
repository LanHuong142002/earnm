import { describe, expect, it } from "vitest";

import type { Comment } from "./types";
import { COMMENT_BATCH, COMMENT_MAX, authorInitial, authorName, bellState, lengthCheck, nextShown, pageComments, sortComments } from "./view";

const c = (id: string, createdAt: string, over: Partial<Comment> = {}): Comment => ({
  id,
  taskId: "t1",
  author: { id: "u1", displayName: "Lan" },
  text: id,
  edited: false,
  remindWith: false,
  createdAt,
  state: "synced",
  ...over,
});

const list = Array.from({ length: 12 }, (_, i) => c(`c${String(i).padStart(2, "0")}`, `2026-11-01T00:${String(i).padStart(2, "0")}:00.000Z`));

describe("sortComments", () => {
  it("newest first puts the latest on top, oldest first the reverse", () => {
    const shuffled = [list[3]!, list[0]!, list[2]!];
    expect(sortComments(shuffled, "newest").map((x) => x.id)).toEqual(["c03", "c02", "c00"]);
    expect(sortComments(shuffled, "oldest").map((x) => x.id)).toEqual(["c00", "c02", "c03"]);
  });
  it("breaks a tie on time by id, the same way in both orders", () => {
    const a = c("a", "2026-11-01T00:00:00.000Z");
    const b = c("b", "2026-11-01T00:00:00.000Z");
    expect(sortComments([b, a], "oldest").map((x) => x.id)).toEqual(["a", "b"]);
    expect(sortComments([a, b], "newest").map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("does not change the list it is given", () => {
    const input = [list[1]!, list[0]!];
    sortComments(input, "oldest");
    expect(input.map((x) => x.id)).toEqual(["c01", "c00"]);
  });
});

describe("pageComments", () => {
  it("shows a batch of 5 and says how many remain", () => {
    const page = pageComments(list, "oldest", COMMENT_BATCH);
    expect(page.items.map((x) => x.id)).toEqual(["c00", "c01", "c02", "c03", "c04"]);
    expect(page.shown).toBe(5);
    expect(page.remaining).toBe(7);
    expect(page.allShown).toBe(false);
  });
  it("shows everything, and allShown, once the count covers the list", () => {
    const page = pageComments(list, "newest", 50);
    expect(page.items).toHaveLength(12);
    expect(page.shown).toBe(12);
    expect(page.remaining).toBe(0);
    expect(page.allShown).toBe(true);
  });
  it("an empty list has nothing remaining and is not 'seen all'", () => {
    const page = pageComments([], "newest", COMMENT_BATCH);
    expect(page).toEqual({ items: [], shown: 0, remaining: 0, allShown: false });
  });
});

describe("nextShown", () => {
  it("adds a batch and stops at the total", () => {
    expect(nextShown(5, 12)).toBe(10);
    expect(nextShown(10, 12)).toBe(12);
    expect(nextShown(12, 12)).toBe(12);
  });
});

describe("bellState", () => {
  it("involved: on and tappable, or off and tappable", () => {
    expect(bellState(true, true)).toBe("on");
    expect(bellState(false, true)).toBe("off-tappable");
  });
  it("not involved: on but read-only, or hidden when off", () => {
    expect(bellState(true, false)).toBe("on-readonly");
    expect(bellState(false, false)).toBe("hidden");
  });
});

describe("lengthCheck", () => {
  it("empty or only spaces cannot be sent", () => {
    expect(lengthCheck("")).toEqual({ length: 0, over: 0, empty: true, canSend: false });
    expect(lengthCheck("  \n ").canSend).toBe(false);
  });
  it("counts the trimmed text, so up to 1000 can be sent", () => {
    const ok = lengthCheck(` ${"a".repeat(COMMENT_MAX)} `);
    expect(ok).toEqual({ length: 1000, over: 0, empty: false, canSend: true });
  });
  it("over 1000 says how many characters to remove and cannot be sent", () => {
    const check = lengthCheck("a".repeat(1012));
    expect(check.over).toBe(12);
    expect(check.canSend).toBe(false);
    expect(check.empty).toBe(false);
  });
});

describe("author", () => {
  it("shows the author's name and initial", () => {
    expect(authorName(c("x", "2026-11-01T00:00:00.000Z"), "Former")).toBe("Lan");
    expect(authorInitial(c("x", "2026-11-01T00:00:00.000Z"), "Former")).toBe("L");
  });
  it("falls back to the neutral name when the author is gone", () => {
    const gone = c("x", "2026-11-01T00:00:00.000Z", { author: null });
    expect(authorName(gone, "Người dùng cũ")).toBe("Người dùng cũ");
    expect(authorInitial(gone, "Người dùng cũ")).toBe("N");
  });
});
