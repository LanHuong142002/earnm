import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, useTestApp } from "../test/helpers.js";
import { createSession, hashToken, resetSessionCleanup, resolveSession, revokeSession } from "./sessions.js";

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
  beforeEach(() => resetSessionCleanup());

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

  it("extends the idle window on every authenticated request, exactly", async () => {
    const userId = await makeUser();
    const token = await createSession(prisma, userId, clock.now());
    clock.advanceMs(89 * DAY + 59 * 60 * 1000);
    expect(await resolveSession(prisma, token, clock.now())).not.toBeNull();
    clock.advanceMs(89 * DAY + 59 * 60 * 1000);
    expect(await resolveSession(prisma, token, clock.now())).not.toBeNull();
    clock.advanceMs(90 * DAY);
    expect(await resolveSession(prisma, token, clock.now())).toBeNull();
  });

  it("deletes expired sessions at the next sign-in once an hour has passed", async () => {
    const userId = await makeUser();
    const old = await createSession(prisma, userId, clock.now());
    clock.advanceMs(91 * DAY);
    await createSession(prisma, userId, clock.now()); // runs the cleanup
    expect(await prisma.session.count()).toBe(1);
    expect(await resolveSession(prisma, old, clock.now())).toBeNull();
  });

  it("runs the cleanup at most once an hour", async () => {
    const userId = await makeUser();
    await createSession(prisma, userId, clock.now()); // cleanup runs, nothing to delete
    const oldToken = "old-token";
    await prisma.session.create({
      data: { userId, tokenHash: hashToken(oldToken), lastUsedAt: new Date(clock.now().getTime() - 91 * DAY) },
    });
    clock.advanceMs(30 * 60 * 1000);
    await createSession(prisma, userId, clock.now());
    expect(await prisma.session.count()).toBe(3); // within the hour: old row stays
    clock.advanceMs(31 * 60 * 1000);
    await createSession(prisma, userId, clock.now());
    expect(await prisma.session.count()).toBe(3); // old row gone, one added
    expect(await resolveSession(prisma, oldToken, clock.now())).toBeNull();
  });

  it("does not fail the request when the cleanup fails", async () => {
    const userId = await makeUser();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const del = vi.spyOn(prisma.session, "deleteMany").mockRejectedValueOnce(
      Object.assign(new Error("secret detail"), { name: "BoomError" }),
    );
    const token = await createSession(prisma, userId, clock.now());
    expect(token).toBeTruthy();
    expect(JSON.stringify(spy.mock.calls)).toContain("BoomError");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret detail");
    del.mockRestore();
    spy.mockRestore();
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
