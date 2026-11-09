import { config } from "dotenv";
import type { Express } from "express";
import { beforeAll, beforeEach, afterAll, expect } from "vitest";
import { createApp } from "../app.js";
import { createPrismaClient } from "../db.js";

config({ quiet: true });

const testUrl = process.env["TEST_DATABASE_URL"];
if (!testUrl) throw new Error("TEST_DATABASE_URL is not set.");

export const prisma = createPrismaClient(testUrl);

export interface TestClock {
  now: () => Date;
  set: (d: Date) => void;
  advanceMs: (ms: number) => void;
}

export function createClock(start = new Date("2026-01-01T00:00:00Z")): TestClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    set: (d) => {
      current = d.getTime();
    },
    advanceMs: (ms) => {
      current += ms;
    },
  };
}

async function connectWithRetry(attempts = 5): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 200 * 2 ** i));
    }
  }
  throw new Error(`Test database unreachable after ${attempts} attempts: ${String(last)}`, {
    cause: last,
  });
}

/** Builds an app on the test database and truncates Session and User before each test. */
export function useTestApp(): { app: Express; clock: TestClock } {
  const clock = createClock();
  const app = createApp({ prisma, now: clock.now });
  // The first query of a run can hit a cold database connection and fail; wake it up first.
  beforeAll(async () => {
    await connectWithRetry();
  }, 30_000);
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Session", "User" CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  return { app, clock };
}

/** Asserts the exact error response shape: { error: { code, message } } and nothing else. */
export function expectError(
  res: { status: number; body: unknown },
  status: number,
  code: string,
): void {
  expect(res.status).toBe(status);
  expect(Object.keys(res.body as object)).toEqual(["error"]);
  const error = (res.body as { error: Record<string, unknown> }).error;
  expect(Object.keys(error).sort()).toEqual(["code", "message"]);
  expect(error["code"]).toBe(code);
  expect(typeof error["message"]).toBe("string");
}
