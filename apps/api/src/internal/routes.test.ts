import type { Express } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { expectError, prisma, useTestApp } from "../test/helpers.js";

const SECRET = "test-only-fake-internal-secret-0123456789abcdef";
const SAME_LENGTH_WRONG = "x".repeat(SECRET.length);
const DIFFERENT_LENGTH_WRONG = "short-wrong-value-for-test";

function build(opts: { internalSecret?: string; trustProxy?: number; db?: typeof prisma } = {}): Express {
  return createApp({
    prisma: opts.db ?? prisma,
    now: () => new Date(),
    ...(opts.internalSecret !== undefined ? { internalSecret: opts.internalSecret } : {}),
    ...(opts.trustProxy !== undefined ? { trustProxy: opts.trustProxy } : {}),
  });
}

describe("internal routes", () => {
  useTestApp();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /internal/tick with the right secret returns ok", async () => {
    const res = await request(build({ internalSecret: SECRET }))
      .post("/internal/tick")
      .set("Authorization", `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("POST /internal/tick does not touch the database", async () => {
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error("database touched");
        },
      },
    ) as unknown as typeof prisma;
    const app = build({ internalSecret: SECRET, db: throwing });
    const res = await request(app)
      .post("/internal/tick")
      .set("Authorization", `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /internal/ip reports the forwarded client address when a proxy hop is trusted", async () => {
    const res = await request(build({ internalSecret: SECRET, trustProxy: 1 }))
      .get("/internal/ip")
      .set("Authorization", `Bearer ${SECRET}`)
      .set("X-Forwarded-For", "203.0.113.7");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ip: "203.0.113.7" });
  });

  it("GET /internal/ip ignores X-Forwarded-For when no proxy is trusted", async () => {
    const res = await request(build({ internalSecret: SECRET, trustProxy: 0 }))
      .get("/internal/ip")
      .set("Authorization", `Bearer ${SECRET}`)
      .set("X-Forwarded-For", "203.0.113.7");
    expect(res.status).toBe(200);
    expect(res.body.ip).not.toBe("203.0.113.7");
  });

  const endpoints = [
    ["POST", "/internal/tick"],
    ["GET", "/internal/ip"],
  ] as const;

  describe.each(endpoints)("%s %s rejection", (method, path) => {
    function call(app: Express, header?: string) {
      const req = method === "POST" ? request(app).post(path) : request(app).get(path);
      return header === undefined ? req : req.set("Authorization", header);
    }

    it.each([
      ["no header", undefined],
      ["Basic scheme", "Basic xyz"],
      ["empty Bearer value", "Bearer "],
      ["wrong secret of the same length", `Bearer ${SAME_LENGTH_WRONG}`],
      ["wrong secret of a different length", `Bearer ${DIFFERENT_LENGTH_WRONG}`],
    ])("returns 401 for %s", async (_name, header) => {
      const res = await call(build({ internalSecret: SECRET }), header);
      expectError(res, 401, "unauthorized");
    });

    it("refuses every request when no secret is configured", async () => {
      const res = await call(build(), `Bearer ${SAME_LENGTH_WRONG}`);
      expectError(res, 401, "unauthorized");
    });

    it("never echoes or logs the submitted value or the secret", async () => {
      const spies = [
        vi.spyOn(console, "log").mockImplementation(() => {}),
        vi.spyOn(console, "error").mockImplementation(() => {}),
        vi.spyOn(console, "warn").mockImplementation(() => {}),
      ];
      const res = await call(build({ internalSecret: SECRET }), `Bearer ${SAME_LENGTH_WRONG}`);
      expectError(res, 401, "unauthorized");
      expect(res.text).not.toContain(SAME_LENGTH_WRONG);
      expect(res.text).not.toContain(SECRET);
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      expect(logged).not.toContain(SAME_LENGTH_WRONG);
      expect(logged).not.toContain(SECRET);
    });
  });

  it("GET /internal/tick (wrong method) does not succeed", async () => {
    const res = await request(build({ internalSecret: SECRET }))
      .get("/internal/tick")
      .set("Authorization", `Bearer ${SECRET}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
