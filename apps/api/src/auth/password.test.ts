import { describe, expect, it } from "vitest";
import { dummyVerify, hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("verifies the password it hashed", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("wrong password!", stored)).toBe(false);
  });

  it("does not contain the password in the stored value", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).not.toContain("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
  });

  it("produces different values for the same password", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
  });

  it("returns false for tampered or malformed stored values", async () => {
    const stored = await hashPassword("correct horse battery");
    const parts = stored.split("$");
    const hash = parts[5] ?? "";
    const flipped = (hash[0] === "A" ? "B" : "A") + hash.slice(1);
    const tampered = [...parts.slice(0, 5), flipped].join("$");
    const badParams = [parts[0], "0", parts[2], parts[3], parts[4], parts[5]].join("$");
    const shortHash = [...parts.slice(0, 5), hash.slice(0, 8)].join("$");

    for (const bad of [
      tampered,
      badParams,
      shortHash,
      "",
      "garbage",
      "scrypt$a$b$c$d$e",
      "bcrypt$1$2$3$4$5",
      `${stored}$extra`,
      "scrypt$32768$8$1$$",
    ]) {
      expect(await verifyPassword("correct horse battery", bad)).toBe(false);
    }
  });

  it("dummyVerify resolves false without throwing", async () => {
    expect(await dummyVerify("anything at all")).toBe(false);
  });
});
