import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  deriveInviteKey,
  formatCode,
  generateCode,
  hashCode,
  normalizeCode,
} from "./code.js";

describe("invite codes", () => {
  it("has a 31-character alphabet without 0 O 1 I L", () => {
    expect(CODE_ALPHABET).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
    expect(CODE_ALPHABET).toHaveLength(31);
  });

  it("generates 8-character codes from the alphabet only", () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  it.each(["k7qm-r4xp", " K7QM R4XP ", "K7QMR4XP", "k7 qm-r4 xp"])(
    "normalizes %j",
    (input) => {
      expect(normalizeCode(input)).toBe("K7QMR4XP");
    },
  );

  it.each(["K7QMR4X", "K7QMR4XPA", "", "K7QMR4XO", "K7QMR4X0", "K7QMR4XI", "K7QMR4X1", "K7QMR4XL", "K7QM_R4X"])(
    "rejects %j",
    (input) => {
      expect(normalizeCode(input)).toBeNull();
    },
  );

  it("formats as XXXX-XXXX", () => {
    expect(formatCode("K7QMR4XP")).toBe("K7QM-R4XP");
  });

  it("hashes the same code and key to the same value, and differs by key or code", () => {
    const k1 = deriveInviteKey("a".repeat(32));
    const k2 = deriveInviteKey("b".repeat(32));
    expect(hashCode("K7QMR4XP", k1)).toBe(hashCode("K7QMR4XP", k1));
    expect(hashCode("K7QMR4XP", k1)).not.toBe(hashCode("K7QMR4XP", k2));
    expect(hashCode("K7QMR4XP", k1)).not.toBe(hashCode("K7QMR4XQ", k1));
    expect(hashCode("K7QMR4XP", k1)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode("K7QMR4XP", k1)).not.toContain("K7QMR4XP");
  });

  it("derives a key deterministically from the secret", () => {
    expect(deriveInviteKey("a".repeat(32)).equals(deriveInviteKey("a".repeat(32)))).toBe(true);
    expect(deriveInviteKey("a".repeat(32)).equals(deriveInviteKey("b".repeat(32)))).toBe(false);
  });
});
