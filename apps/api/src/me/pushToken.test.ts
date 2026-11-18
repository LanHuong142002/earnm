import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { addMember, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";

describe("push tokens (AC14)", () => {
  const { app, clock } = useTestApp();
  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const TOKEN = "ExponentPushToken[abc123]";

  it("registers a token for the caller", async () => {
    const me = await createSignedInUser(clock);
    const res = await request(app).put("/me/push-token").set(...bearer(me.token)).send({ token: TOKEN });
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    const row = await prisma.devicePushToken.findUnique({ where: { token: TOKEN } });
    expect(row?.userId).toBe(me.id);
    expect(row?.lastSyncedAt).toBeNull();
  });

  it("keeps the sync time when the same user registers again", async () => {
    const me = await createSignedInUser(clock);
    await request(app).put("/me/push-token").set(...bearer(me.token)).send({ token: TOKEN });
    const synced = new Date("2026-01-01T00:00:00Z");
    await prisma.devicePushToken.update({ where: { token: TOKEN }, data: { lastSyncedAt: synced } });
    await request(app).put("/me/push-token").set(...bearer(me.token)).send({ token: TOKEN });
    expect((await prisma.devicePushToken.findUnique({ where: { token: TOKEN } }))?.lastSyncedAt).toEqual(synced);
  });

  it("moves the token to another user and forgets its sync time", async () => {
    const a = await createSignedInUser(clock);
    const b = await createSignedInUser(clock);
    await request(app).put("/me/push-token").set(...bearer(a.token)).send({ token: TOKEN });
    await prisma.devicePushToken.update({ where: { token: TOKEN }, data: { lastSyncedAt: new Date() } });
    await request(app).put("/me/push-token").set(...bearer(b.token)).send({ token: TOKEN });
    const rows = await prisma.devicePushToken.findMany({ where: { token: TOKEN } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(b.id);
    expect(rows[0]?.lastSyncedAt).toBeNull();
  });

  it("clears the project syncs of a token that moves, so the new owner is not considered synced", async () => {
    const a = await createSignedInUser(clock);
    const b = await createSignedInUser(clock);
    const t = clock.now();
    const p = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t, descriptionEditedAt: t, currencyEditedAt: t },
    });
    await addMember(p.id, a.id, "owner");
    await request(app).put("/me/push-token").set(...bearer(a.token)).send({ token: TOKEN });
    await request(app).get(`/projects/${p.id}/reminders`).set(...bearer(a.token)).set("X-Push-Token", TOKEN);
    expect(await prisma.deviceProjectSync.count({ where: { token: TOKEN } })).toBe(1);
    await request(app).put("/me/push-token").set(...bearer(b.token)).send({ token: TOKEN });
    expect(await prisma.deviceProjectSync.count({ where: { token: TOKEN } })).toBe(0);
  });

  it("keeps the just-registered token when the per-user cap is exceeded", async () => {
    const me = await createSignedInUser(clock);
    const tokens = Array.from({ length: 11 }, (_, i) => `ExponentPushToken[t${i}]`);
    for (const t of tokens) {
      await prisma.devicePushToken.create({ data: { token: t, userId: me.id, createdAt: new Date("2026-01-01T00:00:00Z") } });
    }
    clock.advanceMs(1000);
    const res = await request(app).put("/me/push-token").set(...bearer(me.token)).send({ token: tokens[0]! });
    expect(res.status).toBe(204);
    const left = await prisma.devicePushToken.findMany({ where: { userId: me.id } });
    expect(left).toHaveLength(10);
    expect(left.map((r) => r.token)).toContain(tokens[0]);
  });

  it("unregisters only the caller's own token", async () => {
    const a = await createSignedInUser(clock);
    const b = await createSignedInUser(clock);
    await request(app).put("/me/push-token").set(...bearer(a.token)).send({ token: TOKEN });
    const other = await request(app).delete("/me/push-token").set(...bearer(b.token)).send({ token: TOKEN });
    expect(other.status).toBe(204);
    expect(await prisma.devicePushToken.count()).toBe(1);
    const own = await request(app).delete("/me/push-token").set(...bearer(a.token)).send({ token: TOKEN });
    expect(own.status).toBe(204);
    expect(await prisma.devicePushToken.count()).toBe(0);
  });

  it("refuses a missing, empty or oversized token, and a signed-out caller", async () => {
    const me = await createSignedInUser(clock);
    for (const body of [{}, { token: "" }, { token: "x".repeat(300) }, { token: TOKEN, extra: 1 }]) {
      expectError(await request(app).put("/me/push-token").set(...bearer(me.token)).send(body), 400, "validation_failed");
    }
    expectError(await request(app).put("/me/push-token").send({ token: TOKEN }), 401, "not_signed_in");
    expectError(await request(app).delete("/me/push-token").send({ token: TOKEN }), 401, "not_signed_in");
  });

  it("never returns a push token to anyone", async () => {
    const a = await createSignedInUser(clock);
    await request(app).put("/me/push-token").set(...bearer(a.token)).send({ token: TOKEN });
    const res = await request(app).get("/me").set(...bearer(a.token));
    expect(JSON.stringify(res.body)).not.toContain("abc123");
  });

  describe("reminders sync time", () => {
    async function project(me: { id: string; token: string }) {
      const t = clock.now();
      const p = await prisma.project.create({
        data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t, descriptionEditedAt: t, currencyEditedAt: t },
      });
      await addMember(p.id, me.id, "owner");
      return p.id;
    }
    const syncs = () => prisma.deviceProjectSync.findMany();

    it("is recorded per project when the reminders are fetched, not when the task list is", async () => {
      const me = await createSignedInUser(clock);
      const p = await project(me);
      const p2 = await project(me);
      await request(app).put("/me/push-token").set(...bearer(me.token)).send({ token: TOKEN });
      clock.advanceMs(5_000);
      await request(app).get(`/projects/${p}/tasks`).set(...bearer(me.token)).set("X-Push-Token", TOKEN);
      expect(await syncs()).toEqual([]);
      const res = await request(app).get(`/projects/${p}/reminders`).set(...bearer(me.token)).set("X-Push-Token", TOKEN);
      expect(res.status).toBe(200);
      const rows = await syncs();
      expect(rows.map((r) => [r.token, r.projectId, r.lastSyncedAt])).toEqual([[TOKEN, p, clock.now()]]);
      expect(rows.some((r) => r.projectId === p2)).toBe(false);
    });

    it("is not recorded for a failed fetch, someone else's token, or without the header", async () => {
      const me = await createSignedInUser(clock);
      const other = await createSignedInUser(clock);
      const p = await project(me);
      await request(app).put("/me/push-token").set(...bearer(other.token)).send({ token: TOKEN });
      await request(app).get(`/projects/${p}/reminders`).set(...bearer(me.token)).set("X-Push-Token", TOKEN);
      await request(app).get(`/projects/${p}/reminders`).set(...bearer(me.token));
      const outsider = await request(app).get(`/projects/${p}/reminders`).set(...bearer(other.token)).set("X-Push-Token", TOKEN);
      expect(outsider.status).toBe(404);
      expect(await syncs()).toEqual([]);
    });
  });
});
