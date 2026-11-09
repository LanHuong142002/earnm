export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const EMAIL_FAILURE_LIMIT = 5;
export const IP_FAILURE_LIMIT = 20;
export const SIGN_UP_IP_LIMIT = 10;
const SWEEP_EVERY_WRITES = 100;

export interface SignInLimiterOptions {
  now: () => Date;
  emailLimit?: number;
  ipLimit?: number;
}

export interface SignInKey {
  email: string;
  ip: string;
}

/** Opaque reservation returned by tryAcquire. Settle it with fail or release. */
export interface AttemptHandle {
  readonly email: string;
  readonly ip: string;
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
 * In-memory sliding window of failure timestamps per email and per IP, plus a count of
 * in-flight attempts so parallel requests cannot all pass the check before any fails.
 * A failure counts while it is less than FAILURE_WINDOW_MS old, so at exactly
 * 15 minutes it no longer counts. Expired entries are pruned on read and swept for all
 * keys every SWEEP_EVERY_WRITES recordings. No timers. Keys are never logged.
 */
export function createSignInLimiter({
  now,
  emailLimit = EMAIL_FAILURE_LIMIT,
  ipLimit = IP_FAILURE_LIMIT,
}: SignInLimiterOptions): SignInLimiter {
  const byEmail = new Map<string, number[]>();
  const byIp = new Map<string, number[]>();
  const inflightEmail = new Map<string, number>();
  const inflightIp = new Map<string, number>();
  let writes = 0;

  function live(map: Map<string, number[]>, key: string, nowMs: number): number[] {
    const times = map.get(key);
    if (!times) return [];
    const kept = times.filter((t) => nowMs - t < FAILURE_WINDOW_MS);
    if (kept.length === 0) map.delete(key);
    else if (kept.length !== times.length) map.set(key, kept);
    return kept;
  }

  function sweep(map: Map<string, number[]>, nowMs: number): void {
    for (const key of [...map.keys()]) live(map, key, nowMs);
  }

  function add(map: Map<string, number[]>, key: string, nowMs: number): void {
    const kept = live(map, key, nowMs);
    kept.push(nowMs);
    map.set(key, kept);
  }

  function bump(map: Map<string, number>, key: string, delta: number): void {
    const next = (map.get(key) ?? 0) + delta;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  }

  function settle(handle: AttemptHandle): boolean {
    if (handle.settled) return false;
    handle.settled = true;
    bump(inflightEmail, handle.email, -1);
    bump(inflightIp, handle.ip, -1);
    return true;
  }

  return {
    tryAcquire({ email, ip }) {
      const nowMs = now().getTime();
      if (
        live(byEmail, email, nowMs).length + (inflightEmail.get(email) ?? 0) >= emailLimit ||
        live(byIp, ip, nowMs).length + (inflightIp.get(ip) ?? 0) >= ipLimit
      ) {
        return null;
      }
      bump(inflightEmail, email, 1);
      bump(inflightIp, ip, 1);
      return { email, ip, settled: false };
    },
    fail(handle) {
      if (!settle(handle)) return;
      const nowMs = now().getTime();
      add(byEmail, handle.email, nowMs);
      add(byIp, handle.ip, nowMs);
      writes += 1;
      if (writes % SWEEP_EVERY_WRITES === 0) {
        sweep(byEmail, nowMs);
        sweep(byIp, nowMs);
      }
    },
    release(handle) {
      settle(handle);
    },
    size() {
      return byEmail.size + byIp.size + inflightEmail.size + inflightIp.size;
    },
  };
}

/** Per-IP limit on sign-up attempts of any outcome. */
export function createSignUpLimiter({ now }: { now: () => Date }): SignInLimiter {
  return createSignInLimiter({ now, emailLimit: Infinity, ipLimit: SIGN_UP_IP_LIMIT });
}
