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
import { createChecklistsRouter } from "./routes.js";

describe("/projects/:projectId/tasks/:taskId/checklists", () => {
  useTestApp();
  const clock = createClock();
  const app = express();
  app.use(express.json());
  app.use(
    "/projects/:projectId/tasks/:taskId/checklists",
    createChecklistsRouter({ prisma, now: clock.now }),
  );
  app.use("/projects/:projectId/tasks", createTasksRouter({ prisma, now: clock.now }));
  app.use("/projects", createProjectsRouter({ prisma, now: clock.now }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);

  async function seedTask(projectId: string, createdById: string) {
    const at = clock.now();
    const task = await prisma.task.create({
      data: {
        id: randomUUID(),
        projectId,
        title: "T",
        titleEditedAt: at,
        descriptionEditedAt: at,
        statusEditedAt: at,
        dueEditedAt: at,
        assigneesEditedAt: at,
        labelsEditedAt: at,
        createdById,
      },
    });
    return task.id;
  }

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
    return { p: project.id, t: await seedTask(project.id, owner.id) };
  }

  const base = (p: string, t: string) => `/projects/${p}/tasks/${t}/checklists`;
  const create = (u: User, p: string, t: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post(base(p, t))
      .set(...bearer(u.token))
      .send({ id: randomUUID(), name: "Prep", editedAt: iso(), ...body });
  const rename = (u: User, p: string, t: string, c: string, fields: Record<string, unknown>) =>
    request(app)
      .patch(`${base(p, t)}/${c}`)
      .set(...bearer(u.token))
      .send({ fields });
  const delList = (u: User, p: string, t: string, c: string) =>
    request(app).delete(`${base(p, t)}/${c}`).set(...bearer(u.token));
  const addItem = (u: User, p: string, t: string, c: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post(`${base(p, t)}/${c}/items`)
      .set(...bearer(u.token))
      .send({ id: randomUUID(), text: "Buy milk", editedAt: iso(), ...body });
  const patchItem = (
    u: User,
    p: string,
    t: string,
    c: string,
    i: string,
    fields: Record<string, unknown>,
  ) =>
    request(app)
      .patch(`${base(p, t)}/${c}/items/${i}`)
      .set(...bearer(u.token))
      .send({ fields });
  const delItem = (u: User, p: string, t: string, c: string, i: string) =>
    request(app).delete(`${base(p, t)}/${c}/items/${i}`).set(...bearer(u.token));
  const change = (value: unknown, offsetMs = 0) => ({ value, editedAt: iso(offsetMs) });
  const pause = () => new Promise((r) => setTimeout(r, 5));

  describe("validation (R1, R2)", () => {
    it("enforces the checklist name length after trimming: 0, 60 and 61", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      for (const name of ["", "   ", "a".repeat(61), " " + "a".repeat(61) + " "]) {
        expectError(await create(u, p, t, { name }), 400, "validation_failed");
      }
      expect((await create(u, p, t, { name: "a".repeat(60) })).status).toBe(201);
      const trimmed = await create(u, p, t, { name: "  b  " });
      expect(trimmed.body.name).toBe("b");
      expect(await prisma.checklist.count()).toBe(2);
    });

    it("enforces the item text length after trimming: 0, 200 and 201", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t)).body.id as string;
      for (const text of ["", "  ", "a".repeat(201), " " + "a".repeat(201) + " "]) {
        expectError(await addItem(u, p, t, c, { text }), 400, "validation_failed");
      }
      expect((await addItem(u, p, t, c, { text: "a".repeat(200) })).status).toBe(201);
      expect((await addItem(u, p, t, c, { text: "  x  " })).body.text).toBe("x");
      expect(await prisma.checklistItem.count()).toBe(2);
    });

    it("refuses control characters, bad ids, bad times and extra keys", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t)).body.id as string;
      for (const body of [
        { name: "a\u0000b" },
        { name: "a\nb" },
        { name: "a\u007fb" },
        { id: "nope" },
        { editedAt: "yesterday" },
        { surprise: 1 },
      ]) {
        expectError(await create(u, p, t, body), 400, "validation_failed");
      }
      for (const body of [
        { text: "a\u0000b" },
        { text: "a\tb" },
        { id: "nope" },
        { editedAt: "yesterday" },
        { done: true },
      ]) {
        expectError(await addItem(u, p, t, c, body), 400, "validation_failed");
      }
      expect(await prisma.checklist.count()).toBe(1);
      expect(await prisma.checklistItem.count()).toBe(0);
    });

    it("validates patch fields", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t)).body.id as string;
      const i = (await addItem(u, p, t, c)).body.id as string;
      for (const fields of [
        {},
        { name: change("") },
        { name: change("a".repeat(61)) },
        { name: { value: "x" } },
        { other: change("x") },
      ]) {
        expectError(await rename(u, p, t, c, fields), 400, "validation_failed");
      }
      for (const fields of [
        {},
        { text: change("") },
        { text: change("a".repeat(201)) },
        { done: change("yes") },
        { done: { value: true } },
        { other: change("x") },
      ]) {
        expectError(await patchItem(u, p, t, c, i, fields), 400, "validation_failed");
      }
      const extra = await request(app)
        .patch(`${base(p, t)}/${c}`)
        .set(...bearer(u.token))
        .send({ fields: { name: change("ok") }, more: 1 });
      expectError(extra, 400, "validation_failed");
    });
  });

  describe("create and shapes (R1, R2, R3)", () => {
    it("creates a checklist with no items and a new item that is not done", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const r = await create(u, p, t, { name: "Prep" });
      expect(r.status).toBe(201);
      expect(Object.keys(r.body).sort()).toEqual(["createdAt", "id", "items", "name"]);
      expect(r.body.items).toEqual([]);
      const item = await addItem(u, p, t, r.body.id);
      expect(item.status).toBe(201);
      expect(Object.keys(item.body).sort()).toEqual(["createdAt", "done", "id", "text"]);
      expect(item.body.done).toBe(false);
    });

    it("keeps creation order after edits", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t)).body.id as string;
      const ids: string[] = [];
      for (const text of ["one", "two", "three"]) {
        ids.push((await addItem(u, p, t, c, { text })).body.id);
        await pause();
      }
      clock.advanceMs(1000);
      await patchItem(u, p, t, c, ids[0]!, { text: change("ONE"), done: change(true) });
      await rename(u, p, t, c, { name: change("Renamed") });
      const rows = await prisma.checklistItem.findMany({
        where: { checklistId: c },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      expect(rows.map((r) => r.id)).toEqual(ids);
      expect(rows[0]).toMatchObject({ text: "ONE", done: true });
    });

    it("returns the items in creation order from the repeated create", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const body = { id: randomUUID() };
      const first = await create(u, p, t, body);
      expect(first.status).toBe(201);
      const c = first.body.id as string;
      const a = (await addItem(u, p, t, c, { text: "a" })).body.id;
      await pause();
      const b = (await addItem(u, p, t, c, { text: "b" })).body.id;
      const again = await create(u, p, t, body);
      expect(again.status).toBe(200);
      expect(again.body.items.map((i: { id: string }) => i.id)).toEqual([a, b]);
    });
  });

  describe("limits (R4)", () => {
    it("refuses the 11th checklist on a task but allows one on another task", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      for (let n = 0; n < 10; n++) expect((await create(u, p, t, { name: `c${n}` })).status).toBe(201);
      expectError(await create(u, p, t), 409, "checklist_limit_reached");
      expect(await prisma.checklist.count()).toBe(10);
      const t2 = await seedTask(p, u.id);
      expect((await create(u, p, t2)).status).toBe(201);
    });

    it("refuses the 51st item in a checklist, while a repeat of an existing one still returns 200", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t)).body.id as string;
      const first = randomUUID();
      expect((await addItem(u, p, t, c, { id: first })).status).toBe(201);
      await prisma.checklistItem.createMany({
        data: Array.from({ length: 49 }, (_, n) => ({
          id: randomUUID(),
          checklistId: c,
          text: `i${n}`,
          textEditedAt: clock.now(),
          doneEditedAt: clock.now(),
        })),
      });
      expectError(await addItem(u, p, t, c), 409, "item_limit_reached");
      expect(await prisma.checklistItem.count()).toBe(50);
      expect((await addItem(u, p, t, c, { id: first })).status).toBe(200);
    });
  });

  describe("idempotent create (R1, R2)", () => {
    it("returns 200 with the stored checklist and item on a repeat", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const id = randomUUID();
      const a = await create(u, p, t, { id });
      const b = await create(u, p, t, { id, name: "Different" });
      expect(a.status).toBe(201);
      expect(b.status).toBe(200);
      expect(b.body.name).toBe("Prep");
      const itemId = randomUUID();
      expect((await addItem(u, p, t, id, { id: itemId })).status).toBe(201);
      const again = await addItem(u, p, t, id, { id: itemId, text: "Other" });
      expect(again.status).toBe(200);
      expect(again.body.text).toBe("Buy milk");
      expect(await prisma.checklist.count()).toBe(1);
      expect(await prisma.checklistItem.count()).toBe(1);
    });

    it("refuses an id used under another task or another project, with id_conflict", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const t2 = await seedTask(p, u.id);
      const other = await seed(u);
      const id = randomUUID();
      await create(u, p, t, { id });
      expectError(await create(u, p, t2, { id }), 409, "id_conflict");
      expectError(await create(u, other.p, other.t, { id }), 409, "id_conflict");
      const c2 = (await create(u, p, t2)).body.id as string;
      const itemId = randomUUID();
      await addItem(u, p, t, id, { id: itemId });
      expectError(await addItem(u, p, t2, c2, { id: itemId }), 409, "id_conflict");
      expect(await prisma.checklistItem.count()).toBe(1);
    });

    it("creates once when the same create is sent twice at the same time", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const id = randomUUID();
      const rs = await Promise.all([create(u, p, t, { id }), create(u, p, t, { id })]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(await prisma.checklist.count()).toBe(1);
    });
  });

  describe("membership (R10)", () => {
    it("lets a Member do everything on an Owner's task", async () => {
      const owner = await user();
      const member = await user();
      const { p, t } = await seed(owner, [member]);
      const c = await create(member, p, t);
      expect(c.status).toBe(201);
      clock.advanceMs(1000);
      expect((await rename(member, p, t, c.body.id, { name: change("New") })).body.name).toBe("New");
      const i = await addItem(member, p, t, c.body.id);
      expect(i.status).toBe(201);
      clock.advanceMs(1000);
      const edited =await patchItem(member, p, t, c.body.id, i.body.id, {
        text: change("Edited"),
        done: change(true),
      });
      expect(edited.body).toMatchObject({ text: "Edited", done: true });
      expect((await delItem(member, p, t, c.body.id, i.body.id)).status).toBe(204);
      expect((await delList(member, p, t, c.body.id)).status).toBe(204);
      expect(await prisma.checklist.count()).toBe(0);
    });

    it("gives a non-member the same 404 as a missing task", async () => {
      const owner = await user();
      const outsider = await user();
      const { p, t } = await seed(owner);
      const c = (await create(owner, p, t)).body.id as string;
      const i = (await addItem(owner, p, t, c)).body.id as string;
      const missing = await create(owner, p, randomUUID());
      expectError(missing, 404, "not_found");
      for (const r of [
        await create(outsider, p, t),
        await rename(outsider, p, t, c, { name: change("x") }),
        await delList(outsider, p, t, c),
        await addItem(outsider, p, t, c),
        await patchItem(outsider, p, t, c, i, { done: change(true) }),
        await delItem(outsider, p, t, c, i),
      ]) {
        expectError(r, 404, "not_found");
        expect(r.body).toEqual(missing.body);
      }
      expect(await prisma.checklist.count()).toBe(1);
      expect(await prisma.checklistItem.count()).toBe(1);
    });
  });

  describe("delete (R1, R2)", () => {
    it("removes the items with their checklist and answers 204", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t)).body.id as string;
      await addItem(u, p, t, c);
      await addItem(u, p, t, c);
      expect((await delList(u, p, t, c)).status).toBe(204);
      expect(await prisma.checklistItem.count()).toBe(0);
      expectError(await delList(u, p, t, c), 404, "not_found");
    });

    it("deletes one item and leaves the rest", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t)).body.id as string;
      const i = (await addItem(u, p, t, c)).body.id as string;
      await addItem(u, p, t, c);
      expect((await delItem(u, p, t, c, i)).status).toBe(204);
      expect(await prisma.checklistItem.count()).toBe(1);
      expectError(await delItem(u, p, t, c, i), 404, "not_found");
    });
  });

  describe("last write wins (R11, R12)", () => {
    it("ignores an older done but accepts a newer text in the same request", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t)).body.id as string;
      const i = (await addItem(u, p, t, c)).body.id as string;
      clock.advanceMs(60_000);
      const tick = await patchItem(u, p, t, c, i, { done: change(true) });
      expect(tick.body.done).toBe(true);
      const r = await patchItem(u, p, t, c, i, {
        done: change(false, -30_000),
        text: change("Newer", 0),
      });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ done: true, text: "Newer" });
      const row = await prisma.checklistItem.findUniqueOrThrow({ where: { id: i } });
      expect(row).toMatchObject({ done: true, text: "Newer" });
    });

    it("answers 200 with the current state when the change is older", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t, { name: "Keep" })).body.id as string;
      clock.advanceMs(60_000);
      await rename(u, p, t, c, { name: change("Newest") });
      const r = await rename(u, p, t, c, { name: change("Older", -10_000) });
      expect(r.status).toBe(200);
      expect(r.body.name).toBe("Newest");
    });

    it("caps a time in the future so a later edit still wins", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t)).body.id as string;
      const i = (await addItem(u, p, t, c)).body.id as string;
      clock.advanceMs(1000);
      await patchItem(u, p, t, c, i, { text: change("Future", 365 * 24 * 3600 * 1000) });
      const row = await prisma.checklistItem.findUniqueOrThrow({ where: { id: i } });
      expect(row.textEditedAt.getTime()).toBeLessThanOrEqual(clock.now().getTime());
      clock.advanceMs(1000);
      const r = await patchItem(u, p, t, c, i, { text: change("Later") });
      expect(r.body.text).toBe("Later");
    });

    it("caps a future time on create", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = await create(u, p, t, { editedAt: iso(365 * 24 * 3600 * 1000) });
      const row = await prisma.checklist.findUniqueOrThrow({ where: { id: c.body.id } });
      expect(row.nameEditedAt.getTime()).toBeLessThanOrEqual(clock.now().getTime());
    });

    it("answers 404 for a change to a deleted item or checklist", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t)).body.id as string;
      const i = (await addItem(u, p, t, c)).body.id as string;
      await delItem(u, p, t, c, i);
      expectError(await patchItem(u, p, t, c, i, { done: change(true) }), 404, "not_found");
      await delList(u, p, t, c);
      expectError(await rename(u, p, t, c, { name: change("x") }), 404, "not_found");
      expectError(await patchItem(u, p, t, c, i, { done: change(true) }), 404, "not_found");
      expectError(await addItem(u, p, t, c), 404, "not_found");
    });
  });

  describe("chain of ids (R10)", () => {
    it("gives one 404 body for cross-task, cross-project and malformed ids", async () => {
      const u = await user();
      const a = await seed(u);
      const b = await seed(u);
      const t2 = await seedTask(a.p, u.id);
      const c = (await create(u, a.p, a.t)).body.id as string;
      const i = (await addItem(u, a.p, a.t, c)).body.id as string;
      const cOther = (await create(u, a.p, t2)).body.id as string;
      const responses = [
        // the checklist belongs to another task
        await rename(u, a.p, t2, c, { name: change("x") }),
        await delList(u, a.p, t2, c),
        await addItem(u, a.p, t2, c),
        await patchItem(u, a.p, t2, c, i, { done: change(true) }),
        await delItem(u, a.p, t2, c, i),
        // the item belongs to another checklist
        await patchItem(u, a.p, t2, cOther, i, { done: change(true) }),
        await delItem(u, a.p, a.t, cOther, i),
        // task and checklist from another project
        await create(u, a.p, b.t),
        await rename(u, b.p, a.t, c, { name: change("x") }),
        await addItem(u, b.p, b.t, c),
        // not uuids
        await create(u, a.p, "nope"),
        await rename(u, a.p, a.t, "nope", { name: change("x") }),
        await patchItem(u, a.p, a.t, c, "nope", { done: change(true) }),
        await delItem(u, a.p, a.t, "nope", i),
      ];
      for (const r of responses) {
        expectError(r, 404, "not_found");
        expect(r.body).toEqual(responses[0]!.body);
      }
      expect(await prisma.checklist.count()).toBe(2);
      expect(await prisma.checklistItem.count()).toBe(1);
      const row = await prisma.checklistItem.findUniqueOrThrow({ where: { id: i } });
      expect(row).toMatchObject({ done: false, checklistId: c });
    });
  });

  describe("sign-in (R10)", () => {
    it("answers 401 not_signed_in on every route without a token and with an expired one", async () => {
      const u = await user();
      const { p, t } = await seed(u);
      const c = (await create(u, p, t)).body.id as string;
      const i = (await addItem(u, p, t, c)).body.id as string;
      clock.advanceMs(SESSION_LIFETIME_MS + 1000);
      const calls = (token?: string) => {
        const set = (r: request.Test) => (token ? r.set(...bearer(token)) : r);
        return [
          set(request(app).post(base(p, t))).send({}),
          set(request(app).patch(`${base(p, t)}/${c}`)).send({}),
          set(request(app).delete(`${base(p, t)}/${c}`)),
          set(request(app).post(`${base(p, t)}/${c}/items`)).send({}),
          set(request(app).patch(`${base(p, t)}/${c}/items/${i}`)).send({}),
          set(request(app).delete(`${base(p, t)}/${c}/items/${i}`)),
        ];
      };
      for (const r of await Promise.all(calls())) expectError(r, 401, "not_signed_in");
      for (const r of await Promise.all(calls(u.token))) expectError(r, 401, "not_signed_in");
      expect(await prisma.checklist.count()).toBe(1);
      expect(await prisma.checklistItem.count()).toBe(1);
    });
  });
});
