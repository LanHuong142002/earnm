import { describe, expect, it } from "vitest";
import { deriveInviteKey } from "./code.js";
import { pickInviteKeySource } from "./key-source.js";

describe("pickInviteKeySource", () => {
  it("prefers INVITE_CODE_KEY over INTERNAL_SECRET", () => {
    expect(pickInviteKeySource({ inviteCodeKey: "a".repeat(32), internalSecret: "b".repeat(32) })).toBe(
      "a".repeat(32),
    );
  });

  it("falls back to INTERNAL_SECRET when no INVITE_CODE_KEY is set", () => {
    expect(pickInviteKeySource({ inviteCodeKey: null, internalSecret: "b".repeat(32) })).toBe("b".repeat(32));
    expect(pickInviteKeySource({ internalSecret: "b".repeat(32) })).toBe("b".repeat(32));
  });

  it("is undefined when neither is set (random per-process key)", () => {
    expect(pickInviteKeySource({})).toBeUndefined();
  });

  it("keeps existing invites working: the fallback derives the same key as before", () => {
    const src = pickInviteKeySource({ internalSecret: "b".repeat(32) })!;
    expect(deriveInviteKey(src).equals(deriveInviteKey("b".repeat(32)))).toBe(true);
  });
});
