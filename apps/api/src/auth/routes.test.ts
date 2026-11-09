import type { Express } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { createClock, prisma, useTestApp, type TestClock } from "../test/helpers.js";
import { verifyPassword } from "./password.js";
import { hashToken } from "./sessions.js";

const PASSWORD = "correct horse battery";
const WRONG = "wrong password!";
const MINUTE = 60 * 1000;

describe("auth routes", () => {
  // Registers the table-truncating hook. Each test builds its own app so that
  // limiter state never leaks between tests.
  useTestApp();

  function fresh(): { app: Express; clock: TestClock } {
    const clock = createClock();
    return { app: createApp({ prisma, now: clock.now }), clock };
  }

  function signUp(
    app: Express,
    email = "ana@example.com",
    password = PASSWORD,
    displayName = "Ana",
  ) {
    return request(app).post("/auth/sign-up").send({ email, password, displayName });
  }

  function signIn(app: Express, email: string, password: string) {
    return request(app).post("/auth/sign-in").send({ email, password });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sign-up", () => {
    it("creates the user and returns a working token", async () => {
      const { app } = fresh();
      const res = await signUp(app);
      expect(res.status).toBe(201);
      expect(typeof res.body.token).toBe("string");
      expect(res.body.user).toEqual({
        id: expect.any(String),
        email: "ana@example.com",
        displayName: "Ana",
        language: null,
      });
      const out = await request(app)
        .post("/auth/sign-out")
        .set("Authorization", `Bearer ${res.body.token}`);
      expect(out.status).toBe(204);
    });

    it.each([
      ["email", { email: "not-an-email" }],
      ["password", { password: "1234567" }],
      ["password", { password: "a".repeat(129) }],
      ["displayName", { displayName: "" }],
      ["displayName", { displayName: "   " }],
      ["displayName", { displayName: "a".repeat(51) }],
    ])("rejects an invalid %s", async (field, override) => {
      const { app } = fresh();
      const res = await request(app)
        .post("/auth/sign-up")
        .send({ email: "ana@example.com", password: PASSWORD, displayName: "Ana", ...override });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("validation_failed");
      expect(res.body.error.message).toContain(field);
      expect(await prisma.user.count()).toBe(0);
    });

    it("normalises the email", async () => {
      const { app } = fresh();
      const res = await signUp(app, "  Ana@Example.COM ");
      expect(res.status).toBe(201);
      const stored = await prisma.user.findMany();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.email).toBe("ana@example.com");
    });

    it("stores a hash that verifies only with the password", async () => {
      const { app } = fresh();
      await signUp(app);
      const user = await prisma.user.findFirstOrThrow();
      expect(user.passwordHash).not.toBe(PASSWORD);
      expect(user.passwordHash).not.toContain(PASSWORD);
      expect(await verifyPassword(PASSWORD, user.passwordHash)).toBe(true);
      expect(await verifyPassword(WRONG, user.passwordHash)).toBe(false);
    });

    it("never logs the password", async () => {
      const { app } = fresh();
      const spies = (["log", "error", "warn", "info"] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation(() => {}),
      );
      await signUp(app);
      await signIn(app, "ana@example.com", WRONG);
      await signIn(app, "ana@example.com", PASSWORD);
      await signUp(app, "bad-email", "short-pw-but-8");
      for (const spy of spies) {
        for (const call of spy.mock.calls) {
          const text = JSON.stringify(call);
          expect(text).not.toContain(PASSWORD);
          expect(text).not.toContain(WRONG);
          expect(text).not.toContain("short-pw-but-8");
        }
      }
    });

    it("refuses a duplicate email in another case", async () => {
      const { app } = fresh();
      expect((await signUp(app)).status).toBe(201);
      const res = await signUp(app, "ANA@example.com");
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("email_in_use");
    });

    it("creates exactly one user for two parallel sign-ups", async () => {
      const { app } = fresh();
      const results = await Promise.all([signUp(app), signUp(app)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.user.count()).toBe(1);
    });
  });

  describe("sign-in", () => {
    it("returns a token and user, and stores only the token hash", async () => {
      const { app } = fresh();
      await signUp(app);
      const res = await signIn(app, " ANA@example.com", PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe("ana@example.com");
      const hashes = (await prisma.session.findMany()).map((s) => s.tokenHash);
      expect(hashes).toHaveLength(2);
      expect(hashes).toContain(hashToken(res.body.token));
      expect(hashes).not.toContain(res.body.token);
    });

    it("answers unknown email and wrong password identically", async () => {
      const { app } = fresh();
      await signUp(app);
      const wrong = await signIn(app, "ana@example.com", WRONG);
      const unknown = await signIn(app, "nobody@example.com", WRONG);
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(wrong.status);
      expect(unknown.body).toEqual(wrong.body);
      expect(wrong.body.error).toEqual({
        code: "invalid_credentials",
        message: "Wrong email or password.",
      });
    });

    it("rejects malformed input with a validation error", async () => {
      const { app } = fresh();
      const res = await signIn(app, "nope", "x");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("validation_failed");
    });

    it("blocks the 6th failure for an email, even with the right password, until the window passes", async () => {
      const { app, clock } = fresh();
      await signUp(app);
      for (let i = 0; i < 5; i++) {
        expect((await signIn(app, "ana@example.com", WRONG)).status).toBe(401);
      }
      const blocked = await signIn(app, "ana@example.com", PASSWORD);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("too_many_attempts");
      clock.advanceMs(15 * MINUTE);
      expect((await signIn(app, "ana@example.com", PASSWORD)).status).toBe(200);
    });

    it("blocks the 21st failure from one IP across different emails", async () => {
      const { app } = fresh();
      const attempt = (email: string, ip: string) =>
        request(app)
          .post("/auth/sign-in")
          .set("X-Forwarded-For", ip)
          .send({ email, password: WRONG });
      for (let i = 0; i < 20; i++) {
        expect((await attempt(`user${i}@example.com`, "203.0.113.7")).status).toBe(401);
      }
      const blocked = await attempt("user99@example.com", "203.0.113.7");
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("too_many_attempts");
      expect((await attempt("user99@example.com", "203.0.113.8")).status).toBe(401);
    });
  });

  describe("sign-out", () => {
    it("revokes only the current session", async () => {
      const { app } = fresh();
      const first = await signUp(app);
      const second = await signIn(app, "ana@example.com", PASSWORD);
      const out = await request(app)
        .post("/auth/sign-out")
        .set("Authorization", `Bearer ${first.body.token}`);
      expect(out.status).toBe(204);
      const again = await request(app)
        .post("/auth/sign-out")
        .set("Authorization", `Bearer ${first.body.token}`);
      expect(again.status).toBe(401);
      expect(again.body.error.code).toBe("not_signed_in");
      const other = await request(app)
        .post("/auth/sign-out")
        .set("Authorization", `Bearer ${second.body.token}`);
      expect(other.status).toBe(204);
    });

    it("requires a token", async () => {
      const { app } = fresh();
      const res = await request(app).post("/auth/sign-out");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("not_signed_in");
    });
  });
});
