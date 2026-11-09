import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_LIFETIME_MS = 90 * DAY_MS;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

let lastCleanupMs: number | undefined;

/** For tests: forgets when expired sessions were last deleted. */
export function resetSessionCleanup(): void {
  lastCleanupMs = undefined;
}

/**
 * Deletes expired sessions, at most once an hour per process. Never throws: a failure
 * is logged by error name only and the request carries on.
 */
export async function cleanupExpiredSessions(prisma: PrismaClient, now: Date): Promise<void> {
  const nowMs = now.getTime();
  if (
    lastCleanupMs !== undefined &&
    nowMs >= lastCleanupMs &&
    nowMs - lastCleanupMs < CLEANUP_INTERVAL_MS
  ) {
    return;
  }
  lastCleanupMs = nowMs;
  try {
    await prisma.session.deleteMany({
      where: { lastUsedAt: { lte: new Date(nowMs - SESSION_LIFETIME_MS) } },
    });
  } catch (err) {
    console.error(`Expired session cleanup failed: ${err instanceof Error ? err.name : "unknown error"}`);
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A fresh random token and the hash that is stored in place of it. */
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/** Creates a session and returns the raw token. Only its sha256 hash is stored. */
export async function createSession(
  prisma: PrismaClient,
  userId: string,
  now: Date,
): Promise<string> {
  await cleanupExpiredSessions(prisma, now);
  const { token, tokenHash } = generateToken();
  await prisma.session.create({
    data: { userId, tokenHash, lastUsedAt: now },
  });
  return token;
}

/**
 * Returns the session for a token, or null when unknown or idle for 90 days.
 * Slides lastUsedAt forward on every successful resolve.
 */
export async function resolveSession(
  prisma: PrismaClient,
  token: string,
  now: Date,
): Promise<{ id: string; userId: string } | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!session) return null;
  if (session.lastUsedAt.getTime() + SESSION_LIFETIME_MS <= now.getTime()) {
    return null;
  }
  // updateMany: a session revoked meanwhile is simply not touched, instead of throwing.
  await prisma.session.updateMany({
    where: { id: session.id },
    data: { lastUsedAt: now },
  });
  return { id: session.id, userId: session.userId };
}

/** Deletes a session. Idempotent. */
export async function revokeSession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}
