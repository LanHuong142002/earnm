import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler, notFoundHandler } from "../http/errors.js";
import { createProjectsRouter } from "../projects/routes.js";
import { createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { deriveInviteKey, formatCode, hashCode, normalizeCode } from "./code.js";
import { createInvitesRouter } from "./routes.js";

const DAY = 24 * 3600 * 1000;
const inviteKey = deriveInviteKey("test-internal-secret");

describe("invites", () => {
  useTestApp();
  const clock = createClock();

  /** A fresh app per call, so each test can get its own join limiter. */
  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/projects", createProjectsRouter({ prisma, now: clock.now }));
    app.use(createInvitesRouter({ prisma, now: clock.now, inviteKey }));
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
  }
  const app = makeApp();

  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);
  const auth = (u: User): [string, string] => ["Authorization", `Bearer ${u.token}`];

  async function seedProject(owner: User, members: User[] = [], name = "P") {
    const p = await prisma.project.create({
      data: {
        id: randomUUID(),
        nameEditedAt: clock.now(),
        descriptionEditedAt: clock.now(),
        currencyEditedAt: clock.now(),
        name,
        currency: "VND",
        members: { create: { userId: owner.id, role: "owner" } },
      },
    });
    for (const m of members) {
      await prisma.projectMember.create({ data: { projectId: p.id, userId: m.id, role: "member" } });
    }
    return p.id;
  }
  async function fillMembers(projectId: string, count: number) {
    for (let i = 0; i < count; i++) {
      const u = await prisma.user.create({
        data: { email: `fill${i}-${randomUUID()}@example.com`, passwordHash: "x", displayName: "F" },
      });
      await prisma.projectMember.create({ data: { projectId, userId: u.id, role: "member" } });
    }
  }
  const createInvite = (u: User, projectId: string, a = app) =>
    request(a).post(`/projects/${projectId}/invites`).set(...auth(u)).send({});
  const listInvites = (u: User, projectId: string) =>
    request(app).get(`/projects/${projectId}/invites`).set(...auth(u));
  const revoke = (u: User, projectId: string, inviteId: string) =>
    request(app).delete(`/projects/${projectId}/invites/${inviteId}`).set(...auth(u));
  const join = (u: User, code: unknown, a = app) =>
    request(a).post("/invites/join").set(...auth(u)).send({ code });

  describe("create (AC1, AC5)", () => {
    it("lets an owner create an invite that expires in 7 days", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      const res = await createInvite(owner, pid);
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(["code", "expiresAt", "id"]);
      expect(res.body.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
      expect(new Date(res.body.expiresAt).getTime()).toBe(clock.now().getTime() + 7 * DAY);
    });

    it("gives a member 403, a non-member 404 and a bad project id 404", async () => {
      const owner = await user();
      const member = await user();
      const stranger = await user();
      const pid = await seedProject(owner, [member]);
      expectError(await createInvite(member, pid), 403, "forbidden");
      expectError(await createInvite(stranger, pid), 404, "not_found");
      expectError(await createInvite(owner, randomUUID()), 404, "not_found");
      expectError(await createInvite(owner, "nope"), 404, "not_found");
    });

    it("requires sign-in", async () => {
      const res = await request(app).post(`/projects/${randomUUID()}/invites`).send({});
      expectError(res, 401, "not_signed_in");
    });

    it("rejects unknown body fields", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      const res = await request(app)
        .post(`/projects/${pid}/invites`)
        .set(...auth(owner))
        .send({ extra: 1 });
      expectError(res, 400, "validation_failed");
    });

    it("stores only a hash of the code and never returns the code when listing", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      const res = await createInvite(owner, pid);
      const plain = normalizeCode(res.body.code as string)!;
      const row = await prisma.invite.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.codeHash).toBe(hashCode(plain, inviteKey));
      expect(JSON.stringify(row)).not.toContain(plain);
      const listed = await listInvites(owner, pid);
      expect(JSON.stringify(listed.body)).not.toContain(plain);
      expect(JSON.stringify(listed.body)).not.toContain(formatCode(plain));
    });
  });

  describe("pending cap (AC4)", () => {
    it("refuses a 21st pending invite and allows one after a revoke", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      let firstId = "";
      for (let i = 0; i < 20; i++) {
        const res = await createInvite(owner, pid);
        expect(res.status).toBe(201);
        if (i === 0) firstId = res.body.id as string;
      }
      expectError(await createInvite(owner, pid), 409, "too_many_invites");
      expect((await revoke(owner, pid, firstId)).status).toBe(204);
      expect((await createInvite(owner, pid)).status).toBe(201);
    });

    it("does not count expired invites toward the cap", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      for (let i = 0; i < 20; i++) {
        await prisma.invite.create({
          data: {
            projectId: pid,
            codeHash: `expired-${i}`,
            createdById: owner.id,
            expiresAt: new Date(clock.now().getTime() - DAY),
          },
        });
      }
      expect((await createInvite(owner, pid)).status).toBe(201);
    });

    it("holds the cap when creates run at the same moment", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      const results = await Promise.all(Array.from({ length: 25 }, () => createInvite(owner, pid)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(20);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      expect(await prisma.invite.count({ where: { projectId: pid } })).toBe(20);
    });
  });

  describe("list and revoke (AC5, AC6)", () => {
    it("lists pending invites newest first with the creator's name and no code or email", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      const a = await createInvite(owner, pid);
      clock.advanceMs(1000);
      const b = await createInvite(owner, pid);
      const future = new Date(clock.now().getTime() + DAY);
      // Used, revoked and expired invites are not pending.
      await prisma.invite.create({ data: { projectId: pid, codeHash: "used", expiresAt: future, usedAt: clock.now() } });
      await prisma.invite.create({ data: { projectId: pid, codeHash: "revoked", expiresAt: future, revokedAt: clock.now() } });
      await prisma.invite.create({
        data: { projectId: pid, codeHash: "old", expiresAt: new Date(clock.now().getTime() - 1000) },
      });
      const res = await listInvites(owner, pid);
      expect(res.status).toBe(200);
      expect(res.body.map((i: { id: string }) => i.id)).toEqual([b.body.id, a.body.id]);
      expect(Object.keys(res.body[0]).sort()).toEqual(["createdAt", "createdBy", "expiresAt", "id"]);
      expect(res.body[0].createdBy).toEqual({ displayName: "Bob" });
      expect(JSON.stringify(res.body)).not.toContain("@");
    });

    it("shows createdBy null once the creator account is deleted", async () => {
      const owner = await user();
      const other = await user();
      const pid = await seedProject(owner);
      await prisma.projectMember.create({ data: { projectId: pid, userId: other.id, role: "owner" } });
      await createInvite(other, pid);
      await prisma.user.delete({ where: { id: other.id } });
      const res = await listInvites(owner, pid);
      expect(res.body[0].createdBy).toBeNull();
    });

    it("blocks members and non-members from listing and revoking", async () => {
      const owner = await user();
      const member = await user();
      const stranger = await user();
      const pid = await seedProject(owner, [member]);
      const inv = await createInvite(owner, pid);
      expectError(await listInvites(member, pid), 403, "forbidden");
      expectError(await revoke(member, pid, inv.body.id), 403, "forbidden");
      expectError(await listInvites(stranger, pid), 404, "not_found");
      expectError(await revoke(stranger, pid, inv.body.id), 404, "not_found");
    });

    it("revokes an invite so joining with it gives invalid_invite, and revoking again succeeds", async () => {
      const owner = await user();
      const joiner = await user();
      const pid = await seedProject(owner);
      const inv = await createInvite(owner, pid);
      expect((await revoke(owner, pid, inv.body.id)).status).toBe(204);
      expect((await revoke(owner, pid, inv.body.id)).status).toBe(204);
      expectError(await join(joiner, inv.body.code), 404, "invalid_invite");
      expect((await listInvites(owner, pid)).body).toEqual([]);
    });

    it("leaves a used invite untouched when it is revoked", async () => {
      const owner = await user();
      const joiner = await user();
      const pid = await seedProject(owner);
      const inv = await createInvite(owner, pid);
      expect((await join(joiner, inv.body.code)).status).toBe(200);
      expect((await revoke(owner, pid, inv.body.id)).status).toBe(204);
      const row = await prisma.invite.findUniqueOrThrow({ where: { id: inv.body.id } });
      expect(row.revokedAt).toBeNull();
      expect(row.usedAt).not.toBeNull();
    });

    it("gives 404 for an invite of another project or a malformed invite id", async () => {
      const owner = await user();
      const p1 = await seedProject(owner);
      const p2 = await seedProject(owner);
      const inv = await createInvite(owner, p1);
      expectError(await revoke(owner, p2, inv.body.id), 404, "not_found");
      expectError(await revoke(owner, p1, "nope"), 404, "not_found");
      expectError(await revoke(owner, p1, randomUUID()), 404, "not_found");
      expect((await listInvites(owner, p1)).body).toHaveLength(1);
    });
  });

  describe("join (AC2, AC3, AC7, AC12)", () => {
    it("adds the person as a member and returns the project in the GET /projects shape", async () => {
      const owner = await user();
      const joiner = await user();
      const pid = await seedProject(owner, [], "Trà sữa");
      const inv = await createInvite(owner, pid);
      const res = await join(joiner, inv.body.code);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: pid, name: "Trà sữa", description: "", currency: "VND", role: "member" });
      const listed = await request(app).get("/projects").set(...auth(joiner));
      expect(listed.body).toEqual([res.body]);
      const row = await prisma.invite.findUniqueOrThrow({ where: { id: inv.body.id } });
      expect(row.usedById).toBe(joiner.id);
      expect(row.usedAt).not.toBeNull();
    });

    it("accepts lowercase, spaces and dashes in the code", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      const inv = await createInvite(owner, pid);
      const code = inv.body.code as string;
      const messy = ` ${code.slice(0, 2).toLowerCase()} ${code.slice(2).toLowerCase()} `;
      expect((await join(await user(), messy)).status).toBe(200);
    });

    it("gives the same invalid_invite body for unknown, malformed, used, expired and revoked codes", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      const first = await createInvite(owner, pid);
      expect((await join(await user(), first.body.code)).status).toBe(200);
      const expiring = await createInvite(owner, pid);
      const revoked = await createInvite(owner, pid);
      await revoke(owner, pid, revoked.body.id);
      clock.advanceMs(7 * DAY + 1000);
      const u = await user();
      const bodies: unknown[] = [];
      for (const code of [first.body.code, expiring.body.code, revoked.body.code, "ABCD-EFGH", "short", "0000-0000"]) {
        const r = await join(u, code, makeApp());
        expectError(r, 404, "invalid_invite");
        bodies.push(r.body);
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    });

    it("rejects a missing or non-string code and unknown fields as validation errors", async () => {
      const u = await user();
      for (const body of [{}, { code: 5 }, { code: "ABCD-EFGH", extra: 1 }]) {
        const res = await request(app).post("/invites/join").set(...auth(u)).send(body);
        expectError(res, 400, "validation_failed");
      }
    });

    it("requires sign-in", async () => {
      expectError(await request(app).post("/invites/join").send({ code: "ABCD-EFGH" }), 401, "not_signed_in");
    });

    it("keeps the invite working when the creating owner is later demoted", async () => {
      const owner = await user();
      const second = await user();
      const joiner = await user();
      const pid = await seedProject(owner);
      await prisma.projectMember.create({ data: { projectId: pid, userId: second.id, role: "owner" } });
      const inv = await createInvite(owner, pid);
      await prisma.projectMember.update({
        where: { projectId_userId: { projectId: pid, userId: owner.id } },
        data: { role: "member" },
      });
      expect((await join(joiner, inv.body.code)).status).toBe(200);
    });

    it("removes the invites when the project is deleted", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      await createInvite(owner, pid);
      await prisma.project.delete({ where: { id: pid } });
      expect(await prisma.invite.count()).toBe(0);
    });
  });

  describe("join refusals keep the invite (AC13, AC14)", () => {
    it("tells an existing member already_member and leaves the invite usable", async () => {
      const owner = await user();
      const member = await user();
      const joiner = await user();
      const pid = await seedProject(owner, [member]);
      const inv = await createInvite(owner, pid);
      expectError(await join(member, inv.body.code), 409, "already_member");
      expectError(await join(owner, inv.body.code), 409, "already_member");
      const row = await prisma.invite.findUniqueOrThrow({ where: { id: inv.body.id } });
      expect(row.usedAt).toBeNull();
      expect((await join(joiner, inv.body.code)).status).toBe(200);
    });

    it("refuses with project_full at 50 members and leaves the invite pending", async () => {
      const owner = await user();
      const joiner = await user();
      const pid = await seedProject(owner);
      const inv = await createInvite(owner, pid);
      await fillMembers(pid, 49);
      expect(await prisma.projectMember.count({ where: { projectId: pid } })).toBe(50);
      expectError(await join(joiner, inv.body.code), 409, "project_full");
      const row = await prisma.invite.findUniqueOrThrow({ where: { id: inv.body.id } });
      expect(row.usedAt).toBeNull();
      expect((await listInvites(owner, pid)).body).toHaveLength(1);
    });
  });

  describe("dead codes give one error whoever enters them (R15)", () => {
    it("gives invalid_invite, not already_member, to a member entering a used code", async () => {
      const owner = await user();
      const joiner = await user();
      const pid = await seedProject(owner);
      const inv = await createInvite(owner, pid);
      expect((await join(joiner, inv.body.code)).status).toBe(200);
      expectError(await join(joiner, inv.body.code), 404, "invalid_invite");
      expectError(await join(owner, inv.body.code), 404, "invalid_invite");
    });

    it("gives invalid_invite, not already_member, to a member entering a revoked code", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      const inv = await createInvite(owner, pid);
      expect((await revoke(owner, pid, inv.body.id)).status).toBe(204);
      expectError(await join(owner, inv.body.code), 404, "invalid_invite");
    });

    it("gives invalid_invite, not already_member, to a member entering an expired code", async () => {
      const owner = await user();
      const pid = await seedProject(owner);
      const inv = await createInvite(owner, pid);
      clock.advanceMs(7 * DAY + 1000);
      expectError(await join(owner, inv.body.code), 404, "invalid_invite");
    });

    it("gives invalid_invite, not project_full, to anyone entering a used code at 50 members", async () => {
      const owner = await user();
      const joiner = await user();
      const late = await user();
      const pid = await seedProject(owner);
      const inv = await createInvite(owner, pid);
      expect((await join(joiner, inv.body.code)).status).toBe(200);
      await fillMembers(pid, 48);
      expect(await prisma.projectMember.count({ where: { projectId: pid } })).toBe(50);
      expectError(await join(late, inv.body.code), 404, "invalid_invite");
    });
  });

  describe("concurrency (AC15)", () => {
    it("lets exactly one of two concurrent joins with one code succeed", async () => {
      for (let i = 0; i < 5; i++) {
        const owner = await user();
        const a = await user();
        const b = await user();
        const pid = await seedProject(owner);
        const inv = await createInvite(owner, pid);
        const [ra, rb] = await Promise.all([join(a, inv.body.code), join(b, inv.body.code)]);
        expect([ra.status, rb.status].sort()).toEqual([200, 404]);
        expectError(ra.status === 404 ? ra : rb, 404, "invalid_invite");
        expect(await prisma.projectMember.count({ where: { projectId: pid } })).toBe(2);
      }
    });

    it("never takes more than 50 members when joins race at the cap", async () => {
      for (let i = 0; i < 5; i++) {
        const owner = await user();
        const pid = await seedProject(owner);
        await fillMembers(pid, 48);
        const joiners = [await user(), await user(), await user()];
        const codes: string[] = [];
        for (let j = 0; j < 3; j++) codes.push((await createInvite(owner, pid)).body.code);
        const results = await Promise.all(joiners.map((j, k) => join(j, codes[k])));
        expect(results.filter((r) => r.status === 200)).toHaveLength(1);
        expect(results.filter((r) => r.status === 409)).toHaveLength(2);
        expect(await prisma.projectMember.count({ where: { projectId: pid } })).toBe(50);
      }
    });
  });

  describe("join rate limit (AC11)", () => {
    it("answers 429 too_many_attempts after 10 failures for one account", async () => {
      const a = makeApp();
      const u = await user();
      for (let i = 0; i < 10; i++) expectError(await join(u, "ABCD-EFGH", a), 404, "invalid_invite");
      expectError(await join(u, "ABCD-EFGH", a), 429, "too_many_attempts");
    });

    it("refuses before looking at the code once the limit is hit", async () => {
      const a = makeApp();
      const owner = await user();
      const pid = await seedProject(owner);
      const inv = await createInvite(owner, pid, a);
      const u = await user();
      for (let i = 0; i < 10; i++) await join(u, "ABCD-EFGH", a);
      expectError(await join(u, inv.body.code, a), 429, "too_many_attempts");
      const row = await prisma.invite.findUniqueOrThrow({ where: { id: inv.body.id } });
      expect(row.usedAt).toBeNull();
    });

    it("counts already_member as a failure", async () => {
      const a = makeApp();
      const owner = await user();
      const pid = await seedProject(owner);
      const inv = await createInvite(owner, pid, a);
      for (let i = 0; i < 10; i++) expectError(await join(owner, inv.body.code, a), 409, "already_member");
      expectError(await join(owner, inv.body.code, a), 429, "too_many_attempts");
    });

    it("counts project_full as a failure", async () => {
      const a = makeApp();
      const owner = await user();
      const pid = await seedProject(owner);
      await fillMembers(pid, 49);
      const inv = await createInvite(owner, pid, a);
      const u = await user();
      for (let i = 0; i < 10; i++) expectError(await join(u, inv.body.code, a), 409, "project_full");
      expectError(await join(u, inv.body.code, a), 429, "too_many_attempts");
    });

    it("does not count a successful join as a failure", async () => {
      const a = makeApp();
      const owner = await user();
      const pid = await seedProject(owner);
      const u = await user();
      for (let i = 0; i < 9; i++) await join(u, "ABCD-EFGH", a);
      const inv = await createInvite(owner, pid, a);
      expect((await join(u, inv.body.code, a)).status).toBe(200);
      // 9 failures so far: one more is allowed, then the limit applies.
      expectError(await join(u, "ABCD-EFGH", a), 404, "invalid_invite");
      expectError(await join(u, "ABCD-EFGH", a), 429, "too_many_attempts");
    });

    it("allows attempts again after the 15 minute window", async () => {
      const a = makeApp();
      const u = await user();
      for (let i = 0; i < 10; i++) await join(u, "ABCD-EFGH", a);
      expectError(await join(u, "ABCD-EFGH", a), 429, "too_many_attempts");
      clock.advanceMs(15 * 60 * 1000);
      expectError(await join(u, "ABCD-EFGH", a), 404, "invalid_invite");
    });

    it("never lets parallel attempts exceed the account limit", async () => {
      for (let i = 0; i < 5; i++) {
        const a = makeApp();
        const u = await user();
        const results = await Promise.all(Array.from({ length: 25 }, () => join(u, "ABCD-EFGH", a)));
        expect(results.filter((r) => r.status === 404)).toHaveLength(10);
        expect(results.filter((r) => r.status === 429)).toHaveLength(15);
      }
    });
  });
});
