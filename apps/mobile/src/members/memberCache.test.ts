import { describe, expect, it } from "vitest";

import type { Member } from "../lib/api";
import { createMemoryStore } from "../sync/storage";
import { clearMemberCache, loadMembers, removeProjectMembers, saveMembers } from "./memberCache";

const M: Member[] = [{ userId: "u1", displayName: "An", role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }];

describe("memberCache", () => {
  it("round trips", async () => {
    const s = createMemoryStore();
    await saveMembers(s, "u1", "p1", M);
    expect(await loadMembers(s, "u1", "p1")).toEqual(M);
  });

  it("is empty for another user", async () => {
    const s = createMemoryStore();
    await saveMembers(s, "u1", "p1", M);
    expect(await loadMembers(s, "u2", "p1")).toBeNull();
  });

  it("replaces another user's cache on save", async () => {
    const s = createMemoryStore();
    await saveMembers(s, "u1", "p1", M);
    await saveMembers(s, "u2", "p2", M);
    expect(await loadMembers(s, "u1", "p1")).toBeNull();
    expect(await loadMembers(s, "u2", "p2")).toEqual(M);
  });

  it("clears", async () => {
    const s = createMemoryStore();
    await saveMembers(s, "u1", "p1", M);
    await clearMemberCache(s);
    expect(await loadMembers(s, "u1", "p1")).toBeNull();
  });

  it("removes one project only", async () => {
    const s = createMemoryStore();
    await saveMembers(s, "u1", "p1", M);
    await saveMembers(s, "u1", "p2", M);
    await removeProjectMembers(s, "u1", "p1");
    expect(await loadMembers(s, "u1", "p1")).toBeNull();
    expect(await loadMembers(s, "u1", "p2")).toEqual(M);
  });

  it("ignores garbage in storage", async () => {
    const s = createMemoryStore();
    await s.setJSON("members.cache.v1", { userId: 5 });
    expect(await loadMembers(s, "u1", "p1")).toBeNull();
  });
});
