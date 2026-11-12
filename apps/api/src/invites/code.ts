import { createHmac, randomInt } from "node:crypto";

/** 31 characters; no 0, O, 1, I or L, so a code read aloud or typed by hand is unambiguous. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Strips spaces and dashes and uppercases. Returns null unless the result is a valid code. */
export function normalizeCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, "").toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) {
    if (!CODE_ALPHABET.includes(ch)) return null;
  }
  return code;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Changing INTERNAL_SECRET changes this key, so pending invites stop working (docs/deploy.md). */
export function deriveInviteKey(internalSecret: string): Buffer {
  return createHmac("sha256", internalSecret).update("invite-code-v1").digest();
}

export function hashCode(code: string, key: Buffer): string {
  return createHmac("sha256", key).update(code).digest("hex");
}
