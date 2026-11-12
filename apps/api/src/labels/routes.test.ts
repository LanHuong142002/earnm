import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { SESSION_LIFETIME_MS } from "../auth/sessions.js";
import { errorHandler, notFoundHandler } from "../http/errors.js";
import {
  addMember,
  createClock,
  createSignedInUser,
  expectError,
  prisma,
  useTestApp,
} from "../test/helpers.js";
import { createProjectsRouter } from "../projects/routes.js";
import { createTasksRouter } from "../tasks/routes.js";
import { createLabelsRouter } from "./routes.js";
import { nameKey } from "./nameKey.js";

describe("nameKey", () => {
  it("trims, normalises to NFC and lower-cases", () => {
    expect(nameKey("  PHA CHẾ ")).toBe("pha chế");
    expect(nameKey("Pha chế")).toBe(nameKey("Pha chế"));
    expect(nameKey("Pha chế")).not.toBe(nameKey("Pha che"));
  });
});

describe("/projects/:projectId/labels", () => {
  useTestApp();
  const clock = createClock();
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/tasks", createTasksRouter({ prisma, now: clock.now }));
  app.use("/projects/:projectId/labels", createLabelsRouter({ prisma, now: clock.now }));
  app.use("/projects", createProjectsRouter({ prisma, now: clock.now }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);

  async function seed(owner: User, members: User[] = []) {
    const t = clock.now();
    const project = await prisma.project.create({
      data: {
        id: randomUUID(),
        name: "P",
        currency: "VND",
        nameEditedAt: t,
        descriptionEditedAt: t,
        currencyEditedAt: t,
      },
    });
    await addMember(project.id, owner.id, "owner");
    for (const m of members) await addMember(project.id, m.id, "member");
    return project.id;
  }

  const base = (p: string) => `/projects/${p}/labels`;
  const create = (u: User, p: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post(base(p))
      .set(...bearer(u.token))
      .send({ id: randomUUID(), name: "Urgent", colour: "red", editedAt: iso(), ...body });
  const patch = (u: User, p: string, id: string, fields: Record<string, unknown>) =>
    request(app)
      .patch(`${base(p)}/${id}`)
      .set(...bearer(u.token))
      .send({ fields });
  const del = (u: User, p: string, id: string) =>
    request(app).delete(`${base(p)}/${id}`).set(...bearer(u.token));
  const list = (u: User, p: string) => request(app).get(base(p)).set(...bearer(u.token));
  const change = (value: unknown, offsetMs = 0) => ({ value, editedAt: iso(offsetMs) });

  describe("validation (R6)", () => {
    it("enforces the name length after trimming", async () => {
      const u = await user();
      const p = await seed(u);
      for (const name of ["", "   ", "a".repeat(31), " " + "a".repeat(31) + " "]) {
        expectError(await create(u, p, { name }), 400, "validation_failed");
      }
      const ok = await create(u, p, { name: "a".repeat(30) });
      expect(ok.status).toBe(201);
      const trimmed = await create(u, p, { name: "  b  " });
      expect(trimmed.body.name).toBe("b");
      expect(await prisma.label.count()).toBe(2);
    });

    it("refuses control characters, unknown colours, bad ids and extra keys", async () => {
      const u = await user();
      const p = await seed(u);
      for (const body of [
        { name: "a\u0000b" },
        { name: "a\nb" },
        { name: "a\u007fb" },
        { colour: "pink" },
        { id: "nope" },
        { editedAt: "yesterday" },
        { surprise: 1 },
      ]) {
        expectError(await create(u, p, body), 400, "validation_failed");
      }
      expect(await prisma.label.count()).toBe(0);
    });

    it("accepts every palette colour and returns id, name and colour only", async () => {
      const u = await user();
      const p = await seed(u);
      for (const colour of ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple"]) {
        const r = await create(u, p, { name: colour, colour });
        expect(r.status).toBe(201);
        expect(Object.keys(r.body).sort()).toEqual(["colour", "id", "name"]);
      }
    });

    it("validates patch fields", async () => {
      const u = await user();
      const p = await seed(u);
      const id = (await create(u, p)).body.id as string;
      for (const fields of [
        {},
        { name: change("") },
        { name: change("a".repeat(31)) },
        { name: change("a\u0000") },
        { colour: change("pink") },
        { name: { value: "x" } },
        { other: change("x") },
      ]) {
        expectError(await patch(u, p, id, fields), 400, "validation_failed");
      }
      const extra = await request(app)
        .patch(`${base(p)}/${id}`)
        .set(...bearer(u.token))
        .send({ fields: { name: change("ok") }, more: 1 });
      expectError(extra, 400, "validation_failed");
    });
  });

  describe("limit and duplicate names (R6)", () => {
    it("refuses the 51st label", async () => {
      const u = await user();
      const p = await seed(u);
      await prisma.label.createMany({
        data: Array.from({ length: 50 }, (_, i) => ({
          id: randomUUID(),
          projectId: p,
          name: `L${i}`,
          nameKey: `l${i}`,
          colour: "gray" as const,
          nameEditedAt: clock.now(),
          colourEditedAt: clock.now(),
        })),
      });
      expectError(await create(u, p, { name: "one more" }), 409, "label_limit_reached");
      expect(await prisma.label.count()).toBe(50);
    });

    it("refuses a duplicate ignoring case and spaces, but not diacritics", async () => {
      const u = await user();
      const p = await seed(u);
      expect((await create(u, p, { name: "Pha chế" })).status).toBe(201);
      expectError(await create(u, p, { name: " PHA CHẾ " }), 409, "label_name_taken");
      expectError(await create(u, p, { name: "pha chế" }), 409, "label_name_taken");
      expect((await create(u, p, { name: "Pha che" })).status).toBe(201);
      expect(await prisma.label.count()).toBe(2);
    });

    it("allows the same name in another project", async () => {
      const u = await user();
      const p1 = await seed(u);
      const p2 = await seed(u);
      expect((await create(u, p1, { name: "Same" })).status).toBe(201);
      expect((await create(u, p2, { name: "same" })).status).toBe(201);
    });

    it("refuses a rename to another label's name, rolling back the whole request", async () => {
      const u = await user();
      const p = await seed(u);
      await create(u, p, { name: "Pha chế" });
      const b = (await create(u, p, { name: "Other", colour: "red" })).body;
      clock.advanceMs(1000);
      const r = await patch(u, p, b.id, { name: change(" PHA CHẾ "), colour: change("blue") });
      expectError(r, 409, "label_name_taken");
      const row = await prisma.label.findUniqueOrThrow({ where: { id: b.id } });
      expect(row.name).toBe("Other");
      expect(row.colour).toBe("red");
    });

    it("allows renaming a label to its own name in another case", async () => {
      const u = await user();
      const p = await seed(u);
      const b = (await create(u, p, { name: "urgent" })).body;
      clock.advanceMs(1000);
      const r = await patch(u, p, b.id, { name: change("URGENT") });
      expect(r.status).toBe(200);
      expect(r.body.name).toBe("URGENT");
      const row = await prisma.label.findUniqueOrThrow({ where: { id: b.id } });
      expect(row.nameKey).toBe("urgent");
    });

    it("keeps nameKey in step so a later duplicate is caught after a rename", async () => {
      const u = await user();
      const p = await seed(u);
      const b = (await create(u, p, { name: "Old" })).body;
      clock.advanceMs(1000);
      await patch(u, p, b.id, { name: change("New") });
      expectError(await create(u, p, { name: "new" }), 409, "label_name_taken");
      expect((await create(u, p, { name: "old" })).status).toBe(201);
    });
  });

  describe("idempotent create", () => {
    it("returns 200 with the label for the same id, and 409 id_conflict across projects", async () => {
      const u = await user();
      const p1 = await seed(u);
      const p2 = await seed(u);
      const id = randomUUID();
      const first = await create(u, p1, { id });
      expect(first.status).toBe(201);
      const again = await create(u, p1, { id });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      expectError(await create(u, p2, { id, name: "Other" }), 409, "id_conflict");
      expect(await prisma.label.count()).toBe(1);
    });

    it("survives identical creates at the same moment", async () => {
      const u = await user();
      const p = await seed(u);
      const body = { id: randomUUID(), name: "Race", colour: "teal", editedAt: iso() };
      const rs = await Promise.all(
        [0, 1, 2].map(() =>
          request(app)
            .post(base(p))
            .set(...bearer(u.token))
            .send(body),
        ),
      );
      expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(await prisma.label.count()).toBe(1);
    });
  });

  describe("members and owners (R7)", () => {
    it("lets a Member create, rename and recolour", async () => {
      const owner = await user();
      const m = await user();
      const p = await seed(owner, [m]);
      const id = (await create(m, p)).body.id as string;
      clock.advanceMs(1000);
      const r = await patch(m, p, id, { name: change("Renamed"), colour: change("blue") });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ id, name: "Renamed", colour: "blue" });
    });

    it("refuses a Member delete with 403 and lets an Owner delete", async () => {
      const owner = await user();
      const m = await user();
      const p = await seed(owner, [m]);
      const id = (await create(m, p)).body.id as string;
      expectError(await del(m, p, id), 403, "forbidden");
      expect(await prisma.label.count()).toBe(1);
      expect((await del(owner, p, id)).status).toBe(204);
      expect(await prisma.label.count()).toBe(0);
    });

    it("removes the label from tasks on delete, and a second delete is 404", async () => {
      const owner = await user();
      const p = await seed(owner);
      const task = await request(app)
        .post(`/projects/${p}/tasks`)
        .set(...bearer(owner.token))
        .send({ id: randomUUID(), title: "T", editedAt: iso() });
      expect(task.status).toBe(201);
      const id = (await create(owner, p)).body.id as string;
      await prisma.taskLabel.create({ data: { taskId: task.body.id, labelId: id } });
      expect((await del(owner, p, id)).status).toBe(204);
      expect(await prisma.taskLabel.count()).toBe(0);
      expect(await prisma.task.count()).toBe(1);
      expectError(await del(owner, p, id), 404, "not_found");
    });

    it("removes labels when the project is deleted", async () => {
      const owner = await user();
      const p = await seed(owner);
      await create(owner, p);
      const r = await request(app)
        .delete(`/projects/${p}`)
        .set(...bearer(owner.token));
      expect(r.status).toBe(204);
      expect(await prisma.label.count()).toBe(0);
    });
  });

  describe("last write wins (R11)", () => {
    it("ignores an older colour while accepting a newer name in the same request", async () => {
      const u = await user();
      const p = await seed(u);
      const id = (await create(u, p, { name: "A", colour: "red" })).body.id as string;
      clock.advanceMs(1000);
      const r = await patch(u, p, id, { name: change("B", 5000), colour: change("blue", -5000) });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ id, name: "B", colour: "red" });
    });

    it("caps a future time at the server's time", async () => {
      const u = await user();
      const p = await seed(u);
      const id = (await create(u, p, { name: "A" })).body.id as string;
      clock.advanceMs(1000);
      const DAY = 24 * 3600 * 1000;
      expect((await patch(u, p, id, { name: change("Future", 10 * DAY) })).body.name).toBe("Future");
      // An honest edit made a minute later still beats the capped one.
      clock.advanceMs(60_000);
      const r = await patch(u, p, id, { name: change("Honest") });
      expect(r.body.name).toBe("Honest");
    });

    it("answers 200 with the current values when every change is ignored", async () => {
      const u = await user();
      const p = await seed(u);
      const id = (await create(u, p, { name: "Keep", colour: "green" })).body.id as string;
      const r = await patch(u, p, id, { name: change("Nope", -9000), colour: change("red", -9000) });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ id, name: "Keep", colour: "green" });
    });

    it("does not check the name of an ignored rename", async () => {
      const u = await user();
      const p = await seed(u);
      await create(u, p, { name: "Taken" });
      const id = (await create(u, p, { name: "Mine" })).body.id as string;
      const r = await patch(u, p, id, { name: change("Taken", -9000) });
      expect(r.status).toBe(200);
      expect(r.body.name).toBe("Mine");
    });
  });

  describe("reading", () => {
    it("returns only this project's labels ordered by name", async () => {
      const u = await user();
      const p1 = await seed(u);
      const p2 = await seed(u);
      await create(u, p1, { name: "banana", colour: "yellow" });
      await create(u, p1, { name: "apple", colour: "green" });
      await create(u, p2, { name: "other" });
      const r = await list(u, p1);
      expect(r.status).toBe(200);
      expect(r.body.map((l: { name: string }) => l.name)).toEqual(["apple", "banana"]);
      expect(Object.keys(r.body[0]).sort()).toEqual(["colour", "id", "name"]);
    });
  });

  describe("not found (R10)", () => {
    it("gives one 404 body for non-members, missing projects, bad ids and other projects' labels", async () => {
      const u = await user();
      const stranger = await user();
      const p = await seed(u);
      const other = await seed(u);
      const id = (await create(u, p)).body.id as string;
      const results = [
        await list(stranger, p),
        await create(stranger, p),
        await patch(stranger, p, id, { name: change("x") }),
        await del(stranger, p, id),
        await list(u, randomUUID()),
        await list(u, "not-a-uuid"),
        await patch(u, p, "not-a-uuid", { name: change("x") }),
        await del(u, p, "not-a-uuid"),
        await patch(u, other, id, { name: change("x") }),
        await del(u, other, id),
        await del(u, p, randomUUID()),
      ];
      for (const r of results) expectError(r, 404, "not_found");
      for (const r of results) expect(r.body).toEqual(results[0]!.body);
      expect((await prisma.label.findUniqueOrThrow({ where: { id } })).name).toBe("Urgent");
    });
  });

  describe("authentication (R10)", () => {
    it("requires a valid token on every route", async () => {
      const u = await user();
      const p = await seed(u);
      const id = (await create(u, p)).body.id as string;
      clock.advanceMs(SESSION_LIFETIME_MS + 1000);
      const calls = (token?: string) => {
        const set = (r: request.Test) => (token ? r.set(...bearer(token)) : r);
        return [
          set(request(app).get(base(p))),
          set(request(app).post(base(p))).send({}),
          set(request(app).patch(`${base(p)}/${id}`)).send({}),
          set(request(app).delete(`${base(p)}/${id}`)),
        ];
      };
      for (const r of await Promise.all(calls())) expectError(r, 401, "not_signed_in");
      for (const r of await Promise.all(calls(u.token))) expectError(r, 401, "not_signed_in");
      expect(await prisma.label.count()).toBe(1);
    });
  });
});
