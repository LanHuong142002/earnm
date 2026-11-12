import { describe, expect, it } from "vitest";

import type { Member } from "../lib/api";
import { avatarRowModel } from "./avatarRow";

function make(n: number, name = (i: number) => `Person ${i}`): Member[] {
  return Array.from({ length: n }, (_, i) => ({
    userId: `u${i}`,
    displayName: name(i),
    role: i === 0 ? "owner" : "member",
    joinedAt: "2026-01-01T00:00:00.000Z",
  }));
}

describe("avatarRowModel", () => {
  it.each([
    [1, 1, null],
    [3, 3, null],
    [4, 3, 1],
    [50, 3, 47],
  ])("%i members -> %i avatars, more %s", (n, avatars, more) => {
    const m = avatarRowModel(make(n));
    expect(m.avatars).toHaveLength(avatars);
    expect(m.more).toBe(more);
  });

  it("keeps the given order", () => {
    expect(avatarRowModel(make(5)).avatars.map((a) => a.userId)).toEqual(["u0", "u1", "u2"]);
  });

  it("upper-cases a Vietnamese initial", () => {
    expect(avatarRowModel(make(1, () => "đức")).avatars[0].initial).toBe("Đ");
  });

  it("skips leading spaces", () => {
    expect(avatarRowModel(make(1, () => "   an")).avatars[0].initial).toBe("A");
  });

  it("falls back to ? for an empty name", () => {
    expect(avatarRowModel(make(1, () => "  ")).avatars[0].initial).toBe("?");
  });
});
