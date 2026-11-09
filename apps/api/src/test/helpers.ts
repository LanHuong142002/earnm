import { config } from "dotenv";
import type { Express } from "express";
import { beforeEach, afterAll } from "vitest";
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

/** Builds an app on the test database and truncates Session and User before each test. */
export function useTestApp(): { app: Express; clock: TestClock } {
  const clock = createClock();
  const app = createApp({ prisma, now: clock.now });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Session", "User" CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  return { app, clock };
}
