import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { SESSION_LIFETIME_MS } from "../auth/sessions.js";
import { errorHandler, notFoundHandler } from "../http/errors.js";
import { createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { createProjectsRouter } from "./routes.js";

describe("/projects", () => {
  useTestApp();
  const clock = createClock();
  const app = express();
  app.use(express.json());
  app.use("/projects", createProjectsRouter({ prisma, now: clock.now }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  const DAY = 24 * 3600 * 1000;

  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);

  function create(u: User, body: Record<string, unknown> = {}) {
    return request(app)
      .post("/projects")
      .set(...bearer(u.token))
      .send({ id: randomUUID(), name: "Trà sữa", currency: "VND", editedAt: iso(), ...body });
  }
  function patch(u: User, id: string, fields: Record<string, unknown>) {
    return request(app).patch(`/projects/${id}`).set(...bearer(u.token)).send({ fields });
  }
  const del = (u: User, id: string) =>
    request(app).delete(`/projects/${id}`).set(...bearer(u.token));
  const list = (u: User) => request(app).get("/projects").set(...bearer(u.token));

  /** Creates a project owned by `owner` plus a plain member row for each of `members`. */
  async function seed(owner: User, members: User[] = [], name = "P") {
    const res = await create(owner, { name });
    const id = res.body.id as string;
    for (const m of members) {
      await prisma.projectMember.create({ data: { projectId: id, userId: m.id, role: "member" } });
    }
    return id;
  }

  describe("validation (AC1)", () => {
    it("rejects bad names, descriptions, currency, id and editedAt", async () => {
      const u = await user();
      for (const body of [
        { name: "" },
        { name: "   " },
        { name: "a".repeat(81) },
        { name: " " + "a".repeat(81) + " " },
        { description: "d".repeat(501) },
        { currency: "EUR" },
        { id: "not-a-uuid" },
        { editedAt: "yesterday" },
      ]) {
        expectError(await create(u, body), 400, "validation_failed");
      }
    });

    it("accepts boundary values and both currencies", async () => {
      const u = await user();
      const a = await create(u, { name: "a".repeat(80), description: "", currency: "USD" });
      expect(a.status).toBe(201);
      expect(a.body.currency).toBe("USD");
      const b = await create(u, { name: "  trimmed  ", description: "d".repeat(500) });
      expect(b.status).toBe(201);
      expect(b.body.name).toBe("trimmed");
      const c = await create(u, { editedAt: "2026-01-01T07:00:00+07:00" });
      expect(c.status).toBe(201);
    });

    it("defaults description to empty", async () => {
      const u = await user();
      const res = await create(u);
      expect(res.body.description).toBe("");
    });
  });

  describe("create", () => {
    it("returns the owner role and a matching membership row (AC3, AC4)", async () => {
      const u = await user();
      const id = randomUUID();
      const res = await create(u, { id });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id,
        name: "Trà sữa",
        description: "",
        currency: "VND",
        role: "owner",
      });
      const m = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: id, userId: u.id } },
      });
      expect(m?.role).toBe("owner");
    });

    it("refuses a members field or any unknown field", async () => {
      const u = await user();
      expectError(await create(u, { members: [] }), 400, "validation_failed");
      expectError(await create(u, { extra: 1 }), 400, "validation_failed");
    });

    it("is idempotent for the same person (AC5)", async () => {
      const u = await user();
      const id = randomUUID();
      const first = await create(u, { id });
      const second = await create(u, { id });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(await prisma.project.count({ where: { id } })).toBe(1);
      expect(await prisma.projectMember.count({ where: { projectId: id } })).toBe(1);
    });

    it("refuses another person's project id with 409 and leaves it unchanged (AC5)", async () => {
      const a = await user();
      const b = await user();
      const id = await seed(a, [], "Mine");
      const res = await create(b, { id, name: "Stolen" });
      expectError(res, 409, "id_conflict");
      const row = await prisma.project.findUnique({ where: { id } });
      expect(row?.name).toBe("Mine");
      expect(await prisma.projectMember.count({ where: { projectId: id } })).toBe(1);
    });

    it("sets every edit time to the clamped editedAt", async () => {
      const u = await user();
      const at = iso(-1000);
      const res = await create(u, { editedAt: at });
      const row = await prisma.project.findUniqueOrThrow({ where: { id: res.body.id } });
      for (const t of [row.nameEditedAt, row.descriptionEditedAt, row.currencyEditedAt]) {
        expect(t.toISOString()).toBe(at);
      }
    });
  });

  describe("list (AC6)", () => {
    it("returns each person's own projects with role, ordered by name", async () => {
      const a = await user();
      const b = await user();
      const pb = await seed(b, [], "Bravo");
      await seed(a, [], "Charlie");
      const pa = await seed(a, [b], "Alpha");
      const forA = await list(a);
      expect(forA.status).toBe(200);
      expect(forA.body.map((p: { name: string; role: string }) => [p.name, p.role])).toEqual([
        ["Alpha", "owner"],
        ["Charlie", "owner"],
      ]);
      const forB = await list(b);
      expect(forB.body.map((p: { id: string; role: string }) => [p.id, p.role])).toEqual([
        [pa, "member"],
        [pb, "owner"],
      ]);
      expect(Object.keys(forB.body[0]).sort()).toEqual([
        "currency",
        "description",
        "id",
        "name",
        "role",
      ]);
    });
  });

  describe("patch", () => {
    it("owner can change name, description, currency, or all (AC7)", async () => {
      const o = await user();
      const id = await seed(o);
      clock.advanceMs(1000);
      let res = await patch(o, id, { name: { value: "N", editedAt: iso() } });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id, name: "N", description: "", currency: "VND", role: "owner" });
      clock.advanceMs(1000);
      res = await patch(o, id, { description: { value: "D", editedAt: iso() } });
      expect(res.body.description).toBe("D");
      clock.advanceMs(1000);
      res = await patch(o, id, { currency: { value: "USD", editedAt: iso() } });
      expect(res.body.currency).toBe("USD");
      clock.advanceMs(1000);
      res = await patch(o, id, {
        name: { value: "All", editedAt: iso() },
        description: { value: "All d", editedAt: iso() },
        currency: { value: "VND", editedAt: iso() },
      });
      expect(res.body).toMatchObject({ name: "All", description: "All d", currency: "VND" });
    });

    it("forbids a plain member with 403 (AC7)", async () => {
      const o = await user();
      const m = await user();
      const id = await seed(o, [m]);
      expectError(await patch(m, id, { name: { value: "X", editedAt: iso(1) } }), 403, "forbidden");
      const row = await prisma.project.findUniqueOrThrow({ where: { id } });
      expect(row.name).toBe("P");
    });

    it("changing currency leaves other values unchanged (AC8)", async () => {
      const o = await user();
      const id = (await create(o, { name: "Keep", description: "me" })).body.id as string;
      clock.advanceMs(60_000);
      const res = await patch(o, id, { currency: { value: "USD", editedAt: iso(1) } });
      expect(res.body).toMatchObject({ name: "Keep", description: "me", currency: "USD" });
    });

    it("requires at least one field and refuses unknown ones", async () => {
      const o = await user();
      const id = await seed(o);
      expectError(await patch(o, id, {}), 400, "validation_failed");
      expectError(
        await patch(o, id, { color: { value: "red", editedAt: iso() } }),
        400,
        "validation_failed",
      );
      expectError(
        await request(app)
          .patch(`/projects/${id}`)
          .set(...bearer(o.token))
          .send({ fields: { name: { value: "x", editedAt: iso() } }, extra: 1 }),
        400,
        "validation_failed",
      );
      expectError(
        await patch(o, id, { name: { value: "", editedAt: iso() } }),
        400,
        "validation_failed",
      );
    });

    it("stores the accepted editedAt for that field only (AC12)", async () => {
      const o = await user();
      const id = await seed(o);
      const before = await prisma.project.findUniqueOrThrow({ where: { id } });
      const at = iso(5000);
      clock.advanceMs(10_000);
      await patch(o, id, { name: { value: "Newer", editedAt: at } });
      const after = await prisma.project.findUniqueOrThrow({ where: { id } });
      expect(after.name).toBe("Newer");
      expect(after.nameEditedAt.toISOString()).toBe(at);
      expect(after.descriptionEditedAt).toEqual(before.descriptionEditedAt);
      expect(after.currencyEditedAt).toEqual(before.currencyEditedAt);
    });

    it("ignores an older change and keeps other fields on a mixed order (AC13, AC15)", async () => {
      const o = await user();
      const id = (await create(o, { name: "Orig", editedAt: iso(1000) })).body.id as string;
      clock.advanceMs(60_000);
      // Older than the stored name time: ignored, still 200 with current values.
      const ignored = await patch(o, id, { name: { value: "Old", editedAt: iso(-60_000) } });
      expect(ignored.status).toBe(200);
      expect(ignored.body.name).toBe("Orig");
      // A recent description change does not block a name change that is newer than the name.
      const desc = await patch(o, id, { description: { value: "Recent", editedAt: iso(0) } });
      expect(desc.body.description).toBe("Recent");
      const nameChange = await patch(o, id, { name: { value: "Mid", editedAt: iso(-1000) } });
      expect(nameChange.body).toMatchObject({ name: "Mid", description: "Recent" });
    });

    it("clamps a future editedAt to server now, and a later real change wins (AC14)", async () => {
      const o = await user();
      const id = await seed(o);
      clock.advanceMs(1000);
      const res = await patch(o, id, { name: { value: "Future", editedAt: iso(DAY) } });
      expect(res.body.name).toBe("Future");
      const row = await prisma.project.findUniqueOrThrow({ where: { id } });
      expect(row.nameEditedAt.toISOString()).toBe(clock.now().toISOString());
      clock.advanceMs(1000);
      const later = await patch(o, id, { name: { value: "Real", editedAt: iso() } });
      expect(later.body.name).toBe("Real");
    });
  });

  describe("delete (AC9)", () => {
    it("owner removes the project and memberships; member 403; second delete 404", async () => {
      const o = await user();
      const m = await user();
      const id = await seed(o, [m]);
      expectError(await del(m, id), 403, "forbidden");
      expect((await list(m)).body).toHaveLength(1);
      const res = await del(o, id);
      expect(res.status).toBe(204);
      expect(await prisma.project.count({ where: { id } })).toBe(0);
      expect(await prisma.projectMember.count({ where: { projectId: id } })).toBe(0);
      expect((await list(o)).body).toEqual([]);
      expect((await list(m)).body).toEqual([]);
      expectError(await del(o, id), 404, "not_found");
    });
  });

  describe("hiding other people's projects (AC10)", () => {
    it("gives identical 404 bodies for missing, foreign and non-uuid ids", async () => {
      const o = await user();
      const stranger = await user();
      const id = await seed(o);
      const missing = randomUUID();
      const fields = { name: { value: "X", editedAt: iso(1) } };
      const results = [
        await patch(stranger, id, fields),
        await patch(stranger, missing, fields),
        await patch(stranger, "nope", fields),
        await del(stranger, id),
        await del(stranger, missing),
        await del(stranger, "nope"),
      ];
      for (const r of results) expectError(r, 404, "not_found");
      for (const r of results) expect(r.body).toEqual(results[0]!.body);
      expect(await prisma.project.count({ where: { id } })).toBe(1);
    });
  });

  describe("authentication (AC11)", () => {
    it("requires a valid token on every route", async () => {
      const u = await user();
      const id = await seed(u);
      clock.advanceMs(SESSION_LIFETIME_MS + 1000);
      const calls = (token?: string) => {
        const set = (r: request.Test) => (token ? r.set(...bearer(token)) : r);
        return [
          set(request(app).get("/projects")),
          set(request(app).post("/projects")).send({}),
          set(request(app).patch(`/projects/${id}`)).send({}),
          set(request(app).delete(`/projects/${id}`)),
        ];
      };
      for (const r of await Promise.all(calls())) expectError(r, 401, "not_signed_in");
      for (const r of await Promise.all(calls(u.token))) expectError(r, 401, "not_signed_in");
    });
  });
});
