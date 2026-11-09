import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
// scrypt needs about 128 * N * r bytes (32 MiB here); leave headroom.
const MAXMEM = 128 * N * R * 2;

function derive(plain: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r, p, maxmem: MAXMEM };
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, KEY_BYTES, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(plain, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  return Number(value);
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const n = parsePositiveInt(parts[1]);
    const r = parsePositiveInt(parts[2]);
    const p = parsePositiveInt(parts[3]);
    // Only accept the parameters we write, so a crafted value can't force huge work.
    if (n !== N || r !== R || p !== P) return false;
    const salt = Buffer.from(parts[4] ?? "", "base64");
    const expected = Buffer.from(parts[5] ?? "", "base64");
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
    const actual = await derive(plain, salt, n, r, p);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Does the same work as verifyPassword against a fixed hash; always false. */
export async function dummyVerify(plain: string): Promise<false> {
  dummyHash ??= hashPassword("dummy-password-for-timing").catch((e: unknown) => {
    // Don't cache a failure: the next call tries again.
    dummyHash = undefined;
    throw e;
  });
  await verifyPassword(plain, await dummyHash);
  return false;
}
