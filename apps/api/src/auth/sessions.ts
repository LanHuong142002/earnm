import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_LIFETIME_MS = 90 * DAY_MS;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session and returns the raw token. Only its sha256 hash is stored. */
export async function createSession(
  prisma: PrismaClient,
  userId: string,
  now: Date,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), lastUsedAt: now },
  });
  return token;
}

/**
 * Returns the session for a token, or null when unknown or idle for 90 days.
 * Slides lastUsedAt forward when it is more than an hour old.
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
  if (now.getTime() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    // updateMany: a session revoked meanwhile is simply not touched, instead of throwing.
    await prisma.session.updateMany({
      where: { id: session.id },
      data: { lastUsedAt: now },
    });
  }
  return { id: session.id, userId: session.userId };
}

/** Deletes a session. Idempotent. */
export async function revokeSession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}
