import { describe, expect, it } from "vitest";
import {
  EMAIL_FAILURE_LIMIT,
  IP_FAILURE_LIMIT,
  createSignInLimiter,
  createSignUpLimiter,
  FAILURE_WINDOW_MS,
  type SignInKey,
} from "./rate-limit.js";

function setup() {
  let current = new Date("2026-01-01T00:00:00.000Z").getTime();
  const now = () => new Date(current);
  const limiter = createSignInLimiter({ now });
  return {
    limiter,
    now,
    advance: (ms: number) => {
      current += ms;
    },
    /** Acquires and records a failure. */
    failOnce(key: SignInKey) {
      const h = limiter.tryAcquire(key);
      if (h) limiter.fail(h);
      return h !== null;
    },
    blocked: (key: SignInKey) => {
      const h = limiter.tryAcquire(key);
      if (h) limiter.release(h);
      return h === null;
    },
  };
}

describe("sign-in limiter", () => {
  it("exports the spec limits", () => {
    expect(EMAIL_FAILURE_LIMIT).toBe(5);
    expect(IP_FAILURE_LIMIT).toBe(20);
    expect(FAILURE_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it("does not block after 4 failures for an email", () => {
    const s = setup();
    for (let i = 0; i < 4; i++) s.failOnce({ email: "a@x.com", ip: "1.1.1.1" });
    expect(s.blocked({ email: "a@x.com", ip: "1.1.1.1" })).toBe(false);
  });

  it("blocks after 5 failures and frees exactly 15 minutes after the first", () => {
    const s = setup();
    const who = { email: "a@x.com", ip: "1.1.1.1" };
    for (let i = 0; i < 5; i++) {
      s.failOnce(who);
      s.advance(1000);
    }
    expect(s.blocked(who)).toBe(true);
    s.advance(FAILURE_WINDOW_MS - 5000 - 1);
    expect(s.blocked(who)).toBe(true);
    s.advance(1);
    expect(s.blocked(who)).toBe(false);
  });

  it("blocks an IP after 20 failures across different emails", () => {
    const s = setup();
    for (let i = 0; i < 20; i++) s.failOnce({ email: `u${i}@x.com`, ip: "2.2.2.2" });
    expect(s.blocked({ email: "fresh@x.com", ip: "2.2.2.2" })).toBe(true);
    expect(s.blocked({ email: "fresh@x.com", ip: "3.3.3.3" })).toBe(false);
  });

  it("does not block another email from another IP", () => {
    const s = setup();
    for (let i = 0; i < 5; i++) s.failOnce({ email: "a@x.com", ip: "1.1.1.1" });
    expect(s.blocked({ email: "a@x.com", ip: "1.1.1.1" })).toBe(true);
    expect(s.blocked({ email: "b@x.com", ip: "9.9.9.9" })).toBe(false);
  });

  it("counts in-flight attempts so parallel checks cannot all pass", () => {
    const s = setup();
    const who = { email: "a@x.com", ip: "1.1.1.1" };
    const handles = Array.from({ length: 10 }, () => s.limiter.tryAcquire(who));
    expect(handles.filter((h) => h !== null)).toHaveLength(5);
  });

  it("releasing a slot frees it without recording a failure", () => {
    const s = setup();
    const who = { email: "a@x.com", ip: "1.1.1.1" };
    const handles = Array.from({ length: 5 }, () => s.limiter.tryAcquire(who));
    expect(s.limiter.tryAcquire(who)).toBeNull();
    s.limiter.release(handles[0]!);
    s.limiter.release(handles[0]!); // idempotent
    expect(s.limiter.tryAcquire(who)).not.toBeNull();
    expect(s.limiter.tryAcquire(who)).toBeNull();
  });

  it("sweeps expired keys of every email and IP after enough writes", () => {
    const s = setup();
    for (let i = 0; i < 50; i++) s.failOnce({ email: `old${i}@x.com`, ip: `10.0.0.${i}` });
    expect(s.limiter.size()).toBe(100);
    s.advance(FAILURE_WINDOW_MS);
    // 50 more writes reach the 100-write sweep; none of the old keys is looked up again.
    for (let i = 0; i < 50; i++) s.failOnce({ email: `new${i}@x.com`, ip: `10.1.0.${i}` });
    expect(s.limiter.size()).toBe(100);
  });
});

describe("sign-up limiter", () => {
  it("allows 10 attempts per IP then blocks, per IP", () => {
    const now = () => new Date("2026-01-01T00:00:00Z");
    const l = createSignUpLimiter({ now });
    for (let i = 0; i < 10; i++) {
      const h = l.tryAcquire({ email: "", ip: "1.1.1.1" });
      expect(h).not.toBeNull();
      l.fail(h!);
    }
    expect(l.tryAcquire({ email: "", ip: "1.1.1.1" })).toBeNull();
    expect(l.tryAcquire({ email: "", ip: "1.1.1.2" })).not.toBeNull();
  });
});
