import { isIPv6 } from "node:net";

export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
/** Failures for one email from one IP. */
export const PAIR_FAILURE_LIMIT = 5;
/** Failures for one email from any IP. */
export const EMAIL_FAILURE_LIMIT = 50;
export const IP_FAILURE_LIMIT = 20;
export const SIGN_UP_IP_LIMIT = 10;
const SWEEP_EVERY_WRITES = 100;

/**
 * Bucket key for an IP: IPv4-mapped IPv6 becomes plain IPv4, other IPv6 addresses are
 * keyed by their /64 (first four hextets, expanded), anything else is kept as is.
 */
export function normalizeIp(ip: string): string {
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped) return mapped[1] as string;
  if (!isIPv6(lower)) return ip;
  let addr = lower;
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  // An embedded IPv4 tail (a.b.c.d) occupies the last two hextets.
  const v4 = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (v4) {
    const [, head, a, b, c, d] = v4 as unknown as [string, string, string, string, string, string];
    const hi = ((Number(a) << 8) | Number(b)).toString(16);
    const lo = ((Number(c) << 8) | Number(d)).toString(16);
    addr = `${head}${hi}:${lo}`;
  }
  const halves = addr.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  const groups =
    halves.length === 2
      ? [...left, ...Array<string>(Math.max(missing, 0)).fill("0"), ...right]
      : left;
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":");
}

export interface SignInLimiterOptions {
  now: () => Date;
  pairLimit?: number;
  emailLimit?: number;
  ipLimit?: number;
}

export interface SignInKey {
  email: string;
  ip: string;
}

/** Opaque reservation returned by tryAcquire. Settle it with fail or release. */
export interface AttemptHandle {
  readonly keys: readonly string[];
  settled: boolean;
}

export interface SignInLimiter {
  /**
   * Checks the limits and reserves a slot in one synchronous step. Returns null when
   * live failures plus in-flight attempts already reach a limit.
   */
  tryAcquire(key: SignInKey): AttemptHandle | null;
  /** Settles the reservation as a recorded failure. Idempotent. */
  fail(handle: AttemptHandle): void;
  /** Settles the reservation without recording a failure (success or error). Idempotent. */
  release(handle: AttemptHandle): void;
  /** Number of tracked keys (failures or in-flight), for tests. */
  size(): number;
}

/**
 * In-memory sliding window of failure timestamps per (email, IP) pair, per email and
 * per IP, plus a count of in-flight attempts so parallel requests cannot all pass the
 * check before any fails. IPs are bucketed with normalizeIp. A failure counts while it
 * is less than FAILURE_WINDOW_MS old, so at exactly 15 minutes it no longer counts.
 * Expired entries are pruned on read and swept for all keys every SWEEP_EVERY_WRITES
 * recordings. No timers. Keys are never logged.
 */
export function createSignInLimiter({
  now,
  pairLimit = PAIR_FAILURE_LIMIT,
  emailLimit = EMAIL_FAILURE_LIMIT,
  ipLimit = IP_FAILURE_LIMIT,
}: SignInLimiterOptions): SignInLimiter {
  // One map per dimension. Keys are prefixed with the dimension index.
  const limits = [pairLimit, emailLimit, ipLimit];
  const failures = new Map<string, number[]>();
  const inflight = new Map<string, number>();
  let writes = 0;

  function live(key: string, nowMs: number): number[] {
    const times = failures.get(key);
    if (!times) return [];
    const kept = times.filter((t) => nowMs - t < FAILURE_WINDOW_MS);
    if (kept.length === 0) failures.delete(key);
    else if (kept.length !== times.length) failures.set(key, kept);
    return kept;
  }

  function sweep(nowMs: number): void {
    for (const key of [...failures.keys()]) live(key, nowMs);
  }

  function bump(key: string, delta: number): void {
    const next = (inflight.get(key) ?? 0) + delta;
    if (next <= 0) inflight.delete(key);
    else inflight.set(key, next);
  }

  function settle(handle: AttemptHandle): boolean {
    if (handle.settled) return false;
    handle.settled = true;
    for (const k of handle.keys) bump(k, -1);
    return true;
  }

  return {
    tryAcquire({ email, ip }) {
      const nowMs = now().getTime();
      const nip = normalizeIp(ip);
      // Dimensions with an infinite limit are not tracked at all.
      const keys = [`p|${email}|${nip}`, `e|${email}`, `i|${nip}`].filter(
        (_, i) => Number.isFinite(limits[i]),
      );
      const active = limits.filter((l) => Number.isFinite(l));
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i] as string;
        if (live(k, nowMs).length + (inflight.get(k) ?? 0) >= (active[i] as number)) {
          return null;
        }
      }
      for (const k of keys) bump(k, 1);
      return { keys, settled: false };
    },
    fail(handle) {
      if (!settle(handle)) return;
      const nowMs = now().getTime();
      for (const k of handle.keys) {
        const kept = live(k, nowMs);
        kept.push(nowMs);
        failures.set(k, kept);
      }
      writes += 1;
      if (writes % SWEEP_EVERY_WRITES === 0) sweep(nowMs);
    },
    release(handle) {
      settle(handle);
    },
    size() {
      return failures.size + inflight.size;
    },
  };
}

/** Per-IP limit on sign-up attempts of any outcome. */
export function createSignUpLimiter({ now }: { now: () => Date }): SignInLimiter {
  return createSignInLimiter({
    now,
    pairLimit: Infinity,
    emailLimit: Infinity,
    ipLimit: SIGN_UP_IP_LIMIT,
  });
}
