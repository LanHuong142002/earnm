export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const EMAIL_FAILURE_LIMIT = 5;
export const IP_FAILURE_LIMIT = 20;

export interface SignInLimiterOptions {
  now: () => Date;
}

export interface SignInKey {
  email: string;
  ip: string;
}

export interface SignInLimiter {
  isBlocked(key: SignInKey): boolean;
  recordFailure(key: SignInKey): void;
}

/**
 * In-memory sliding window of failure timestamps per email and per IP.
 * A failure counts while it is less than FAILURE_WINDOW_MS old, so at exactly
 * 15 minutes it no longer counts. Entries are pruned on read and write and
 * empty keys are deleted. No timers. Keys are never logged.
 */
export function createSignInLimiter({ now }: SignInLimiterOptions): SignInLimiter {
  const byEmail = new Map<string, number[]>();
  const byIp = new Map<string, number[]>();

  function live(map: Map<string, number[]>, key: string, nowMs: number): number[] {
    const times = map.get(key);
    if (!times) return [];
    const kept = times.filter((t) => nowMs - t < FAILURE_WINDOW_MS);
    if (kept.length === 0) map.delete(key);
    else if (kept.length !== times.length) map.set(key, kept);
    return kept;
  }

  function add(map: Map<string, number[]>, key: string, nowMs: number): void {
    const kept = live(map, key, nowMs);
    kept.push(nowMs);
    map.set(key, kept);
  }

  return {
    isBlocked({ email, ip }) {
      const nowMs = now().getTime();
      return (
        live(byEmail, email, nowMs).length >= EMAIL_FAILURE_LIMIT ||
        live(byIp, ip, nowMs).length >= IP_FAILURE_LIMIT
      );
    },
    recordFailure({ email, ip }) {
      const nowMs = now().getTime();
      add(byEmail, email, nowMs);
      add(byIp, ip, nowMs);
    },
  };
}
