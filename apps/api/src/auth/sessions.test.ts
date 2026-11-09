import { describe, expect, it } from "vitest";
import { prisma, useTestApp } from "../test/helpers.js";
import { createSession, resolveSession, revokeSession } from "./sessions.js";

const DAY = 24 * 60 * 60 * 1000;

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: "a@example.com",
      passwordHash: "placeholder-hash",
      displayName: "Test",
    },
  });
  return user.id;
}

describe("sessions", () => {
  const { clock } = useTestApp();

  it("stores a hash, not the token", async () => {
    const userId = await makeUser();
    const token = await createSession(prisma, userId, clock.now());
    const rows = await prisma.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resolves a valid token", async () => {
    const userId = await makeUser();
    const token = await createSession(prisma, userId, clock.now());
    const s = await resolveSession(prisma, token, clock.now());
    expect(s?.userId).toBe(userId);
  });

  it("rejects an unknown token", async () => {
    expect(await resolveSession(prisma, "nope", clock.now())).toBeNull();
  });

  it("rejects a token unused for exactly 90 days", async () => {
    const userId = await makeUser();
    const token = await createSession(prisma, userId, clock.now());
    clock.advanceMs(90 * DAY);
    expect(await resolveSession(prisma, token, clock.now())).toBeNull();
  });

  it("accepts a token one ms before 90 days", async () => {
    const userId = await makeUser();
    const token = await createSession(prisma, userId, clock.now());
    clock.advanceMs(90 * DAY - 1);
    expect(await resolveSession(prisma, token, clock.now())).not.toBeNull();
  });

  it("keeps a token used on day 89 alive on day 178", async () => {
    const userId = await makeUser();
    const token = await createSession(prisma, userId, clock.now());
    clock.advanceMs(89 * DAY);
    expect(await resolveSession(prisma, token, clock.now())).not.toBeNull();
    clock.advanceMs(89 * DAY);
    expect(await resolveSession(prisma, token, clock.now())).not.toBeNull();
  });

  it("rejects a revoked token, and revoking twice is fine", async () => {
    const userId = await makeUser();
    const token = await createSession(prisma, userId, clock.now());
    const s = await resolveSession(prisma, token, clock.now());
    await revokeSession(prisma, s?.id ?? "");
    await revokeSession(prisma, s?.id ?? "");
    expect(await resolveSession(prisma, token, clock.now())).toBeNull();
  });
});
