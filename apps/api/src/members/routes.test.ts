import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler, notFoundHandler } from "../http/errors.js";
import { createProjectsRouter } from "../projects/routes.js";
import { createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { createMembersRouter } from "./routes.js";

describe("members", () => {
  useTestApp();
  const clock = createClock();

  const app = express();
  app.use(express.json());
  app.use("/projects", createProjectsRouter({ prisma, now: clock.now }));
  app.use(createMembersRouter({ prisma, now: clock.now }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);
  const auth = (u: User): [string, string] => ["Authorization", `Bearer ${u.token}`];

  /** Seeds a project; members get distinct, increasing createdAt unless `at` is given. */
  async function seedProject(owners: User[], members: User[] = [], name = "P") {
    const p = await prisma.project.create({
      data: {
        id: randomUUID(),
        nameEditedAt: clock.now(),
        descriptionEditedAt: clock.now(),
        currencyEditedAt: clock.now(),
        name,
        currency: "VND",
      },
    });
    let t = Date.UTC(2026, 0, 1);
    for (const [users, role] of [
      [owners, "owner"],
      [members, "member"],
    ] as const) {
      for (const u of users) {
        t += 1000;
        await prisma.projectMember.create({
          data: { projectId: p.id, userId: u.id, role, createdAt: new Date(t) },
        });
      }
    }
    return p.id;
  }

  const list = (u: User, pid: string) => request(app).get(`/projects/${pid}/members`).set(...auth(u));
  const setRole = (u: User, pid: string, target: string, body: unknown) =>
    request(app).patch(`/projects/${pid}/members/${target}`).set(...auth(u)).send(body as object);
  const remove = (u: User, pid: string, target: string) =>
    request(app).delete(`/projects/${pid}/members/${target}`).set(...auth(u));
  const leave = (u: User, pid: string) => request(app).post(`/projects/${pid}/leave`).set(...auth(u));
  const roleOf = async (pid: string, uid: string) =>
    (await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: uid } } }))
      ?.role ?? null;

  describe("list (AC16)", () => {
    it("lists owners first, then by join time, with no email", async () => {
      const o1 = await user();
      const o2 = await user();
      const m1 = await user();
      const m2 = await user();
      const pid = await seedProject([o1, o2], [m1, m2]);
      // m1 joined earlier than o2 in wall-clock terms; owners still come first.
      await prisma.projectMember.update({
        where: { projectId_userId: { projectId: pid, userId: m1.id } },
        data: { createdAt: new Date(Date.UTC(2025, 0, 1)) },
      });
      const res = await list(m2, pid);
      expect(res.status).toBe(200);
      expect(res.body.map((m: { userId: string }) => m.userId)).toEqual([o1.id, o2.id, m1.id, m2.id]);
      expect(res.body.map((m: { role: string }) => m.role)).toEqual(["owner", "owner", "member", "member"]);
      for (const m of res.body) {
        expect(Object.keys(m).sort()).toEqual(["displayName", "joinedAt", "role", "userId"]);
        expect(m.displayName).toBe("Bob");
        expect(new Date(m.joinedAt).toISOString()).toBe(m.joinedAt);
      }
      expect(JSON.stringify(res.body)).not.toContain("@example.com");
    });

    it("breaks a join-time tie by user id", async () => {
      const a = await user();
      const b = await user();
      const c = await user();
      const pid = await seedProject([a]);
      const at = new Date(Date.UTC(2026, 5, 1));
      for (const u of [b, c]) {
        await prisma.projectMember.create({ data: { projectId: pid, userId: u.id, role: "member", createdAt: at } });
      }
      const res = await list(a, pid);
      expect(res.body.slice(1).map((m: { userId: string }) => m.userId)).toEqual([b.id, c.id].sort());
    });

    it("gives a non-member, an unknown project and a bad id 404", async () => {
      const o = await user();
      const stranger = await user();
      const pid = await seedProject([o]);
      expectError(await list(stranger, pid), 404, "not_found");
      expectError(await list(o, randomUUID()), 404, "not_found");
      expectError(await list(o, "nope"), 404, "not_found");
    });

    it("requires sign-in", async () => {
      const res = await request(app).get(`/projects/${randomUUID()}/members`);
      expectError(res, 401, "not_signed_in");
    });
  });

  describe("change role (AC17, AC18)", () => {
    it("lets an owner promote a member and shows it in the list", async () => {
      const o = await user();
      const m = await user();
      const pid = await seedProject([o], [m]);
      const res = await setRole(o, pid, m.id, { role: "owner" });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(["displayName", "joinedAt", "role", "userId"]);
      expect(res.body).toMatchObject({ userId: m.id, role: "owner" });
      const listed = await list(o, pid);
      expect(listed.body.map((x: { role: string }) => x.role)).toEqual(["owner", "owner"]);
    });

    it("lets an owner demote another owner", async () => {
      const o1 = await user();
      const o2 = await user();
      const pid = await seedProject([o1, o2]);
      const res = await setRole(o1, pid, o2.id, { role: "member" });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("member");
      expect(await roleOf(pid, o2.id)).toBe("member");
    });

    it("lets an owner demote themselves while another owner exists", async () => {
      const o1 = await user();
      const o2 = await user();
      const pid = await seedProject([o1, o2]);
      const res = await setRole(o1, pid, o1.id, { role: "member" });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("member");
      expect(await roleOf(pid, o1.id)).toBe("member");
    });

    it("refuses with last_owner when the sole owner demotes themselves", async () => {
      const o = await user();
      const m = await user();
      const pid = await seedProject([o], [m]);
      const res = await setRole(o, pid, o.id, { role: "member" });
      expectError(res, 409, "last_owner");
      expect(res.body.error.message).toBe("A project needs at least one Owner.");
      expect(await roleOf(pid, o.id)).toBe("owner");
    });

    it("gives a plain member 403 when changing or removing the sole owner", async () => {
      const o = await user();
      const m = await user();
      const pid = await seedProject([o], [m]);
      expectError(await setRole(m, pid, o.id, { role: "member" }), 403, "forbidden");
      expectError(await remove(m, pid, o.id), 403, "forbidden");
      expect(await roleOf(pid, o.id)).toBe("owner");
    });

    it("treats a change to the same role as a no-op 200, even for the sole owner", async () => {
      const o = await user();
      const m = await user();
      const pid = await seedProject([o], [m]);
      expect((await setRole(o, pid, o.id, { role: "owner" })).status).toBe(200);
      const res = await setRole(o, pid, m.id, { role: "member" });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("member");
    });

    it("gives a member 403, a non-member 404 and a bad project id 404", async () => {
      const o = await user();
      const m = await user();
      const stranger = await user();
      const pid = await seedProject([o], [m]);
      expectError(await setRole(m, pid, m.id, { role: "owner" }), 403, "forbidden");
      expectError(await setRole(stranger, pid, m.id, { role: "owner" }), 404, "not_found");
      expectError(await setRole(o, "nope", m.id, { role: "owner" }), 404, "not_found");
      expect(await roleOf(pid, m.id)).toBe("member");
    });

    it("gives 404 for a target outside the project or a non-uuid target", async () => {
      const o = await user();
      const outsider = await user();
      const pid = await seedProject([o]);
      expectError(await setRole(o, pid, outsider.id, { role: "owner" }), 404, "not_found");
      expectError(await setRole(o, pid, randomUUID(), { role: "owner" }), 404, "not_found");
      expectError(await setRole(o, pid, "nope", { role: "owner" }), 404, "not_found");
    });

    it("rejects a bad role and unknown body fields", async () => {
      const o = await user();
      const m = await user();
      const pid = await seedProject([o], [m]);
      expectError(await setRole(o, pid, m.id, { role: "admin" }), 400, "validation_failed");
      expectError(await setRole(o, pid, m.id, {}), 400, "validation_failed");
      expectError(await setRole(o, pid, m.id, { role: "owner", extra: 1 }), 400, "validation_failed");
    });

    it("keeps at least one owner when two owners demote each other at once", async () => {
      for (let round = 0; round < 5; round++) {
        const o1 = await user();
        const o2 = await user();
        const pid = await seedProject([o1, o2]);
        const [a, b] = await Promise.all([
          setRole(o1, pid, o2.id, { role: "member" }),
          setRole(o2, pid, o1.id, { role: "member" }),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 403]);
        expectError(a.status === 403 ? a : b, 403, "forbidden");
        const owners = await prisma.projectMember.count({ where: { projectId: pid, role: "owner" } });
        expect(owners).toBe(1);
      }
    });
  });

  describe("remove (AC17, AC19)", () => {
    it("lets an owner remove a member and another owner", async () => {
      const o1 = await user();
      const o2 = await user();
      const m = await user();
      const pid = await seedProject([o1, o2], [m]);
      expect((await remove(o1, pid, m.id)).status).toBe(204);
      expect((await remove(o1, pid, o2.id)).status).toBe(204);
      const listed = await list(o1, pid);
      expect(listed.body.map((x: { userId: string }) => x.userId)).toEqual([o1.id]);
    });

    it("tells an owner removing themselves to leave instead", async () => {
      const o = await user();
      const pid = await seedProject([o, await user()]);
      const res = await remove(o, pid, o.id);
      expectError(res, 400, "validation_failed");
      expect(res.body.error.message).toMatch(/leave/i);
      expect(await roleOf(pid, o.id)).toBe("owner");
    });

    it("gives a member 403, a non-member 404 and an outside target 404", async () => {
      const o = await user();
      const m = await user();
      const m2 = await user();
      const stranger = await user();
      const pid = await seedProject([o], [m, m2]);
      expectError(await remove(m, pid, m2.id), 403, "forbidden");
      expectError(await remove(stranger, pid, m.id), 404, "not_found");
      expectError(await remove(o, pid, stranger.id), 404, "not_found");
      expectError(await remove(o, pid, "nope"), 404, "not_found");
      expectError(await remove(o, "nope", m.id), 404, "not_found");
    });

    it("locks the removed person out of the project but keeps their other projects", async () => {
      const o = await user();
      const m = await user();
      const pid = await seedProject([o], [m], "First");
      const other = await seedProject([o], [m], "Second");
      expect((await remove(o, pid, m.id)).status).toBe(204);
      const patched = await request(app)
        .patch(`/projects/${pid}`)
        .set(...auth(m))
        .send({ fields: { name: { value: "X", editedAt: clock.now().toISOString() } } });
      expectError(patched, 404, "not_found");
      expectError(await list(m, pid), 404, "not_found");
      expect((await list(m, other)).status).toBe(200);
      const mine = await request(app).get("/projects").set(...auth(m));
      expect(mine.body.map((p: { id: string }) => p.id)).toEqual([other]);
    });
  });

  describe("leave (AC18, AC20)", () => {
    it("lets a member leave and drops the project from their list", async () => {
      const o = await user();
      const m = await user();
      const pid = await seedProject([o], [m]);
      expect((await leave(m, pid)).status).toBe(204);
      const mine = await request(app).get("/projects").set(...auth(m));
      expect(mine.body).toEqual([]);
      expectError(await list(m, pid), 404, "not_found");
    });

    it("lets an owner leave while another owner exists", async () => {
      const o1 = await user();
      const o2 = await user();
      const pid = await seedProject([o1, o2]);
      expect((await leave(o1, pid)).status).toBe(204);
      expect(await roleOf(pid, o1.id)).toBeNull();
    });

    it("refuses with last_owner when the sole owner leaves", async () => {
      const o = await user();
      const m = await user();
      const pid = await seedProject([o], [m]);
      expectError(await leave(o, pid), 409, "last_owner");
      expect(await roleOf(pid, o.id)).toBe("owner");
    });

    it("gives a non-member and a bad id 404", async () => {
      const o = await user();
      const stranger = await user();
      const pid = await seedProject([o]);
      expectError(await leave(stranger, pid), 404, "not_found");
      expectError(await leave(o, "nope"), 404, "not_found");
      expectError(await leave(o, randomUUID()), 404, "not_found");
    });

    it("keeps at least one owner when the only two owners leave at once", async () => {
      for (let round = 0; round < 5; round++) {
        const o1 = await user();
        const o2 = await user();
        const pid = await seedProject([o1, o2]);
        const [a, b] = await Promise.all([leave(o1, pid), leave(o2, pid)]);
        expect([a.status, b.status].sort()).toEqual([204, 409]);
        expectError(a.status === 409 ? a : b, 409, "last_owner");
        const owners = await prisma.projectMember.count({ where: { projectId: pid, role: "owner" } });
        expect(owners).toBe(1);
      }
    });
  });
});
