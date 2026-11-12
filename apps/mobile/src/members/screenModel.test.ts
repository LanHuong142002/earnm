import { describe, expect, it } from "vitest";

import type { Member } from "../lib/api";
import { formatExpiry, inviteLink, membersBody, rowModel, viewerRole } from "./screenModel";

const M = (userId: string, role: "owner" | "member"): Member => ({
  userId,
  displayName: userId,
  role,
  joinedAt: "2026-01-01T00:00:00.000Z",
});

describe("inviteLink", () => {
  it("joins base and code", () => {
    expect(inviteLink("https://api.example.com", "K7QM-R4XP")).toBe("https://api.example.com/i/K7QM-R4XP");
  });
  it("strips trailing slashes from the base", () => {
    expect(inviteLink("https://api.example.com//", "K7QM-R4XP")).toBe("https://api.example.com/i/K7QM-R4XP");
  });
  it("copes with a missing base", () => {
    expect(inviteLink(undefined, "AB")).toBe("/i/AB");
  });
});

describe("viewerRole", () => {
  const list = [M("a", "owner"), M("b", "member")];
  it("uses the member entry", () => {
    expect(viewerRole(list, "b", "owner")).toBe("member");
  });
  it("falls back to the project role", () => {
    expect(viewerRole(null, "b", "owner")).toBe("owner");
    expect(viewerRole(list, "zz", "member")).toBe("member");
  });
  it("is member when nothing is known", () => {
    expect(viewerRole(null, null, null)).toBe("member");
  });
});

describe("rowModel", () => {
  it("owner viewing another member: can manage, offers Make Owner", () => {
    expect(rowModel(M("b", "member"), "a", "owner")).toEqual({ isViewer: false, canManage: true, toggleTo: "owner" });
  });
  it("owner viewing another owner: offers Make Member", () => {
    expect(rowModel(M("c", "owner"), "a", "owner")).toEqual({ isViewer: false, canManage: true, toggleTo: "member" });
  });
  it("owner's own row has no actions", () => {
    expect(rowModel(M("a", "owner"), "a", "owner").canManage).toBe(false);
    expect(rowModel(M("a", "owner"), "a", "owner").isViewer).toBe(true);
  });
  it("a plain member manages nobody", () => {
    expect(rowModel(M("a", "owner"), "b", "member").canManage).toBe(false);
  });
});

describe("formatExpiry", () => {
  it("formats day/month/year in Vietnamese", () => {
    expect(formatExpiry("2026-03-05T12:00:00.000Z", "vi")).toBe("05/03/2026");
  });
  it("formats in English with the same fields", () => {
    expect(formatExpiry("2026-03-05T12:00:00.000Z", "en")).toMatch(/2026/);
  });
});

describe("membersBody (R33)", () => {
  const list = [M("u1", "owner")];
  it("shows the list whenever there are members, even offline", () => {
    expect(membersBody(list, "ready")).toBe("list");
    expect(membersBody(list, "offline")).toBe("list");
  });
  it("waits while loading with nothing cached", () => {
    expect(membersBody(null, "loading")).toBe("loading");
  });
  it("offers a retry when offline with nothing cached", () => {
    expect(membersBody(null, "offline")).toBe("error");
  });
  it("shows nothing and leaves when the project is gone, never a spinner", () => {
    expect(membersBody(null, "gone")).toBe("gone");
    expect(membersBody(list, "gone")).toBe("gone");
  });
});
