import { describe, expect, it } from "vitest";
import {
  EMAIL_FAILURE_LIMIT,
  IP_FAILURE_LIMIT,
  createSignInLimiter,
  FAILURE_WINDOW_MS,
} from "./rate-limit.js";

function setup() {
  let current = new Date("2026-01-01T00:00:00.000Z").getTime();
  const limiter = createSignInLimiter({ now: () => new Date(current) });
  return {
    limiter,
    advance: (ms: number) => {
      current += ms;
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
    const { limiter } = setup();
    for (let i = 0; i < 4; i++) limiter.recordFailure({ email: "a@x.com", ip: "1.1.1.1" });
    expect(limiter.isBlocked({ email: "a@x.com", ip: "1.1.1.1" })).toBe(false);
  });

  it("blocks after 5 failures and frees exactly 15 minutes after the first", () => {
    const { limiter, advance } = setup();
    const who = { email: "a@x.com", ip: "1.1.1.1" };
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure(who);
      advance(1000);
    }
    expect(limiter.isBlocked(who)).toBe(true);
    // 1ms before the first failure turns 15 minutes old: still blocked.
    advance(FAILURE_WINDOW_MS - 5000 - 1);
    expect(limiter.isBlocked(who)).toBe(true);
    // Exactly 15 minutes after the first failure: it no longer counts.
    advance(1);
    expect(limiter.isBlocked(who)).toBe(false);
  });

  it("blocks an IP after 20 failures across different emails", () => {
    const { limiter } = setup();
    for (let i = 0; i < 20; i++) limiter.recordFailure({ email: `u${i}@x.com`, ip: "2.2.2.2" });
    expect(limiter.isBlocked({ email: "fresh@x.com", ip: "2.2.2.2" })).toBe(true);
    expect(limiter.isBlocked({ email: "fresh@x.com", ip: "3.3.3.3" })).toBe(false);
  });

  it("does not block another email from another IP", () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) limiter.recordFailure({ email: "a@x.com", ip: "1.1.1.1" });
    expect(limiter.isBlocked({ email: "a@x.com", ip: "1.1.1.1" })).toBe(true);
    expect(limiter.isBlocked({ email: "b@x.com", ip: "9.9.9.9" })).toBe(false);
  });
});
