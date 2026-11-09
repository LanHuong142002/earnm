import { describe, expect, it } from "vitest";
import {
  EMAIL_FAILURE_LIMIT,
  IP_FAILURE_LIMIT,
  PAIR_FAILURE_LIMIT,
  createSignInLimiter,
  normalizeIp,
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
    expect(PAIR_FAILURE_LIMIT).toBe(5);
    expect(EMAIL_FAILURE_LIMIT).toBe(50);
    expect(IP_FAILURE_LIMIT).toBe(20);
    expect(FAILURE_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it("does not block after 4 failures for an email and IP", () => {
    const s = setup();
    for (let i = 0; i < 4; i++) s.failOnce({ email: "a@x.com", ip: "1.1.1.1" });
    expect(s.blocked({ email: "a@x.com", ip: "1.1.1.1" })).toBe(false);
  });

  it("blocks an email and IP pair after 5 failures and frees exactly 15 minutes after the first", () => {
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
    expect(s.limiter.size()).toBe(150); // pair, email and IP keys
    s.advance(FAILURE_WINDOW_MS);
    // 50 more writes reach the 100-write sweep; none of the old keys is looked up again.
    for (let i = 0; i < 50; i++) s.failOnce({ email: `new${i}@x.com`, ip: `10.1.0.${i}` });
    expect(s.limiter.size()).toBe(150);
  });

  it("blocks the 51st failure for an email across many IPs", () => {
    const s = setup();
    for (let i = 0; i < 50; i++) {
      expect(s.failOnce({ email: "a@x.com", ip: `10.0.${Math.floor(i / 10)}.${i}` })).toBe(true);
    }
    expect(s.blocked({ email: "a@x.com", ip: "99.99.99.99" })).toBe(true);
    expect(s.blocked({ email: "b@x.com", ip: "99.99.99.99" })).toBe(false);
  });

  it("blocks the pair at 5 but the same email from another IP is fine", () => {
    const s = setup();
    for (let i = 0; i < 5; i++) s.failOnce({ email: "a@x.com", ip: "1.1.1.1" });
    expect(s.blocked({ email: "a@x.com", ip: "1.1.1.1" })).toBe(true);
    expect(s.blocked({ email: "a@x.com", ip: "1.1.1.2" })).toBe(false);
  });

  it("shares one bucket between addresses in the same IPv6 /64", () => {
    const s = setup();
    for (let i = 0; i < 20; i++) {
      s.failOnce({ email: `u${i}@x.com`, ip: `2001:db8:1:2::${i + 1}` });
    }
    expect(s.blocked({ email: "z@x.com", ip: "2001:db8:1:2:ffff::9" })).toBe(true);
    expect(s.blocked({ email: "z@x.com", ip: "2001:db8:1:3::1" })).toBe(false);
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

describe("normalizeIp", () => {
  it.each([
    ["::ffff:1.2.3.4", "1.2.3.4"],
    ["1.2.3.4", "1.2.3.4"],
    ["unknown", "unknown"],
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2"],
    ["2001:DB8::1", "2001:db8:0:0"],
    ["2001:0db8:0001:0002::1", "2001:db8:1:2"],
    ["::1", "0:0:0:0"],
    ["::", "0:0:0:0"],
    ["fe80::1%eth0", "fe80:0:0:0"],
    ["1:2:3:4:5:6:7::", "1:2:3:4"],
    ["64:ff9b::1.2.3.4", "64:ff9b:0:0"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });
});
