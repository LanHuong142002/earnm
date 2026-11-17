import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { SESSION_LIFETIME_MS } from "../auth/sessions.js";
import { errorHandler, notFoundHandler } from "../http/errors.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { createProjectsRouter } from "../projects/routes.js";
import { createTasksRouter } from "../tasks/routes.js";
import { createCommentsRouter, MAX_COMMENTS_PER_TASK } from "./routes.js";

describe("/projects/:projectId/tasks/:taskId/comments", () => {
  useTestApp();
  const clock = createClock();
  const app = express();
  app.use(express.json({ limit: "10kb" }));
  app.use("/projects/:projectId/tasks/:taskId/comments", createCommentsRouter({ prisma, now: clock.now }));
  app.use("/projects/:projectId/tasks", createTasksRouter({ prisma, now: clock.now }));
  app.use("/projects", createProjectsRouter({ prisma, now: clock.now }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);

  async function seedTask(projectId: string, createdById: string, assigneeIds: string[] = []) {
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
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
      },
    });
    return task.id;
  }

  async function seed(owner: User, creator: User, assignees: User[] = [], others: User[] = []) {
    const t = clock.now();
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t, descriptionEditedAt: t, currencyEditedAt: t },
    });
    await addMember(project.id, owner.id, "owner");
    for (const m of [creator, ...assignees, ...others]) await addMember(project.id, m.id, "member");
    return { p: project.id, t: await seedTask(project.id, creator.id, assignees.map((a) => a.id)) };
  }

  const base = (p: string, t: string) => `/projects/${p}/tasks/${t}/comments`;
  const create = (u: User, p: string, t: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post(base(p, t))
      .set(...bearer(u.token))
      .send({ id: randomUUID(), text: "Hello", ...body });
  const list = (u: User, p: string, t: string) => request(app).get(base(p, t)).set(...bearer(u.token));
  const patch = (u: User, p: string, t: string, c: string, body: Record<string, unknown>) =>
    request(app)
      .patch(`${base(p, t)}/${c}`)
      .set(...bearer(u.token))
      .send(body);
  const del = (u: User, p: string, t: string, c: string) =>
    request(app).delete(`${base(p, t)}/${c}`).set(...bearer(u.token));

  /** owner (not involved), creator and assignee (involved), bystander (member, not involved), stranger (not a member). */
  async function world() {
    const owner = await user();
    const creator = await user();
    const assignee = await user();
    const bystander = await user();
    const stranger = await user();
    const { p, t } = await seed(owner, creator, [assignee], [bystander]);
    // Edit times are clamped to server time, so give the tests a past to edit in.
    clock.advanceMs(10_000);
    return { owner, creator, assignee, bystander, stranger, p, t };
  }

  // AC11
  it("answers 401 without a valid session", async () => {
    const w = await world();
    expectError(await request(app).get(base(w.p, w.t)), 401, "not_signed_in");
    expectError(await request(app).post(base(w.p, w.t)).send({ id: randomUUID(), text: "x" }), 401, "not_signed_in");
    clock.advanceMs(SESSION_LIFETIME_MS + 1000);
    expectError(await list(w.creator, w.p, w.t), 401, "not_signed_in");
  });

  // AC11
  it("answers 404 not_found to a non-member on every route", async () => {
    const w = await world();
    const c = await create(w.creator, w.p, w.t);
    expect(c.status).toBe(201);
    expectError(await list(w.stranger, w.p, w.t), 404, "not_found");
    expectError(await create(w.stranger, w.p, w.t), 404, "not_found");
    expectError(await patch(w.stranger, w.p, w.t, c.body.id, { text: { value: "x", editedAt: iso() } }), 404, "not_found");
    expectError(await del(w.stranger, w.p, w.t, c.body.id), 404, "not_found");
    expectError(await list(w.creator, w.p, randomUUID()), 404, "not_found");
  });

  // AC1
  it("creates and lists a comment with its author, oldest first", async () => {
    const w = await world();
    const a = await create(w.bystander, w.p, w.t, { text: "  first  " });
    expect(a.status).toBe(201);
    expect(a.body).toEqual({
      id: expect.any(String),
      taskId: w.t,
      author: { id: w.bystander.id, displayName: "Bob" },
      text: "first",
      edited: false,
      remindWith: false,
      createdAt: clock.now().toISOString(),
    });
    clock.advanceMs(1000);
    const b = await create(w.creator, w.p, w.t, { text: "second\nline two" });
    expect(b.status).toBe(201);
    const res = await list(w.owner, w.p, w.t);
    expect(res.status).toBe(200);
    expect(res.body.comments.map((c: { text: string }) => c.text)).toEqual(["first", "second\nline two"]);
  });

  it("accepts 1000 Vietnamese characters within the 10kb body limit", async () => {
    const w = await world();
    expect((await create(w.bystander, w.p, w.t, { text: "ế".repeat(1000) })).status).toBe(201);
  });

  // AC1
  it("rejects empty, blank, 1001-character and extra-field bodies with validation_failed", async () => {
    const w = await world();
    expectError(await create(w.creator, w.p, w.t, { text: "" }), 400, "validation_failed");
    expectError(await create(w.creator, w.p, w.t, { text: "  \n " }), 400, "validation_failed");
    expectError(await create(w.creator, w.p, w.t, { text: "a".repeat(1001) }), 400, "validation_failed");
    expectError(await create(w.creator, w.p, w.t, { extra: 1 }), 400, "validation_failed");
    expectError(await create(w.creator, w.p, w.t, { id: "nope" }), 400, "validation_failed");
    expect((await create(w.creator, w.p, w.t, { text: "a".repeat(1000) })).status).toBe(201);
  });

  // AC2, AC3
  it("sets edited only when the text changes, not the flag", async () => {
    const w = await world();
    const c = (await create(w.creator, w.p, w.t)).body;
    const flag = await patch(w.assignee, w.p, w.t, c.id, { remindWith: { value: true, editedAt: iso(-5000) } });
    expect(flag.status).toBe(200);
    expect(flag.body).toMatchObject({ remindWith: true, edited: false, text: "Hello" });
    const edit = await patch(w.creator, w.p, w.t, c.id, { text: { value: "  Changed ", editedAt: iso(-4000) } });
    expect(edit.body).toMatchObject({ text: "Changed", edited: true, remindWith: true });
  });

  it("does not let an older text edit overwrite a newer one", async () => {
    const w = await world();
    const c = (await create(w.creator, w.p, w.t)).body;
    await patch(w.creator, w.p, w.t, c.id, { text: { value: "new", editedAt: iso(-1000) } });
    const old = await patch(w.creator, w.p, w.t, c.id, { text: { value: "old", editedAt: iso(-5000) } });
    expect(old.body).toMatchObject({ text: "new", edited: true });
  });

  // AC4
  it("lets only the author edit text and delete; another member and an Owner get 403", async () => {
    const w = await world();
    const c = (await create(w.bystander, w.p, w.t)).body;
    for (const other of [w.creator, w.owner]) {
      expectError(await patch(other, w.p, w.t, c.id, { text: { value: "x", editedAt: iso() } }), 403, "forbidden");
      expectError(await del(other, w.p, w.t, c.id), 403, "forbidden");
    }
    expect((await list(w.owner, w.p, w.t)).body.comments[0].text).toBe("Hello");
    expect((await patch(w.bystander, w.p, w.t, c.id, { text: { value: "mine", editedAt: iso(10) } })).status).toBe(200);
    expect((await del(w.bystander, w.p, w.t, c.id)).status).toBe(204);
    expect((await list(w.owner, w.p, w.t)).body.comments).toEqual([]);
  });

  // AC5
  it("refuses the 501st comment with comment_limit_reached", async () => {
    const w = await world();
    await prisma.taskComment.createMany({
      data: Array.from({ length: MAX_COMMENTS_PER_TASK }, (_, i) => ({
        id: randomUUID(),
        taskId: w.t,
        authorId: w.creator.id,
        text: `c${i}`,
      })),
    });
    expectError(await create(w.creator, w.p, w.t), 409, "comment_limit_reached");
    // A retry of an existing comment is not a new one.
    const existing = await prisma.taskComment.findFirstOrThrow({ where: { taskId: w.t } });
    expect((await create(w.creator, w.p, w.t, { id: existing.id })).status).toBe(200);
  });

  // AC6
  it("deletes the comments with the task and nulls the author when the user is deleted", async () => {
    const w = await world();
    const c = (await create(w.bystander, w.p, w.t, { text: "bye" })).body;
    await prisma.user.delete({ where: { id: w.bystander.id } });
    const res = await list(w.owner, w.p, w.t);
    expect(res.body.comments).toEqual([expect.objectContaining({ id: c.id, text: "bye", author: null })]);
    await prisma.task.delete({ where: { id: w.t } });
    expect(await prisma.taskComment.count()).toBe(0);
  });

  // AC7, AC8
  it("lets only involved people set the flag, on create and on patch", async () => {
    const w = await world();
    expectError(await create(w.bystander, w.p, w.t, { remindWith: true }), 403, "forbidden");
    expect(await prisma.taskComment.count()).toBe(0);
    expect((await create(w.creator, w.p, w.t, { remindWith: true })).body.remindWith).toBe(true);
    expect((await create(w.assignee, w.p, w.t, { remindWith: true })).body.remindWith).toBe(true);
    // Someone else's comment: an involved person may flag it, a bystander or a non-involved Owner may not.
    const c = (await create(w.bystander, w.p, w.t)).body;
    const on = await patch(w.creator, w.p, w.t, c.id, { remindWith: { value: true, editedAt: iso(-300) } });
    expect(on.body.remindWith).toBe(true);
    expectError(await patch(w.bystander, w.p, w.t, c.id, { remindWith: { value: false, editedAt: iso(-200) } }), 403, "forbidden");
    expectError(await patch(w.owner, w.p, w.t, c.id, { remindWith: { value: false, editedAt: iso(-200) } }), 403, "forbidden");
    const off = await patch(w.assignee, w.p, w.t, c.id, { remindWith: { value: false, editedAt: iso(-100) } });
    expect(off.body.remindWith).toBe(false);
  });

  // AC9, AC10
  it("shows flags to every member and keeps them after the person stops being involved", async () => {
    const w = await world();
    const c = (await create(w.assignee, w.p, w.t, { remindWith: true })).body;
    await prisma.taskAssignee.deleteMany({ where: { taskId: w.t, userId: w.assignee.id } });
    for (const u of [w.bystander, w.owner, w.assignee]) {
      expect((await list(u, w.p, w.t)).body.comments[0]).toMatchObject({ id: c.id, remindWith: true });
    }
    expectError(await patch(w.assignee, w.p, w.t, c.id, { remindWith: { value: false, editedAt: iso(100) } }), 403, "forbidden");
    const res = await patch(w.assignee, w.p, w.t, c.id, { text: { value: "still mine", editedAt: iso(100) } });
    expect(res.body).toMatchObject({ text: "still mine", remindWith: true });
  });

  // AC13
  it("is idempotent on the same id and 409 on an id used by another task", async () => {
    const w = await world();
    const id = randomUUID();
    const first = await create(w.creator, w.p, w.t, { id });
    expect(first.status).toBe(201);
    const second = await create(w.creator, w.p, w.t, { id, text: "Different" });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await prisma.taskComment.count()).toBe(1);
    const other = await seedTask(w.p, w.creator.id);
    expectError(await create(w.creator, w.p, other, { id }), 409, "id_conflict");
  });

  it("creates the same id once under concurrent requests", async () => {
    const w = await world();
    const id = randomUUID();
    const rs = await Promise.all([1, 2, 3].map(() => create(w.creator, w.p, w.t, { id })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(await prisma.taskComment.count()).toBe(1);
  });

  // AC12
  it("resolves text and flag edits last-write-wins per field, and answers current state", async () => {
    const w = await world();
    const c = (await create(w.creator, w.p, w.t)).body;
    const a = await patch(w.creator, w.p, w.t, c.id, {
      text: { value: "T2", editedAt: iso(-2000) },
      remindWith: { value: true, editedAt: iso(-3000) },
    });
    expect(a.body).toMatchObject({ text: "T2", remindWith: true });
    const b = await patch(w.creator, w.p, w.t, c.id, {
      text: { value: "T1", editedAt: iso(-2500) },
      remindWith: { value: false, editedAt: iso(-1000) },
    });
    expect(b.body).toMatchObject({ text: "T2", remindWith: false });
    // A phone clock in the future is clamped to server time, so a later honest edit still wins.
    await patch(w.creator, w.p, w.t, c.id, { text: { value: "future", editedAt: iso(10 * 86400000) } });
    clock.advanceMs(5000);
    const d = await patch(w.creator, w.p, w.t, c.id, { text: { value: "honest", editedAt: iso() } });
    expect(d.body.text).toBe("honest");
  });

  it("lets an edit made offline before the create reached the server win", async () => {
    const w = await world();
    const id = randomUUID();
    clock.advanceMs(60_000);
    await create(w.creator, w.p, w.t, { id });
    const res = await patch(w.creator, w.p, w.t, id, { text: { value: "typed offline", editedAt: iso(-30_000) } });
    expect(res.body.text).toBe("typed offline");
  });

  it("rejects an empty or unknown patch body", async () => {
    const w = await world();
    const c = (await create(w.creator, w.p, w.t)).body;
    expectError(await patch(w.creator, w.p, w.t, c.id, {}), 400, "validation_failed");
    expectError(await patch(w.creator, w.p, w.t, c.id, { text: { value: "", editedAt: iso() } }), 400, "validation_failed");
    expectError(await patch(w.creator, w.p, w.t, c.id, { text: { value: "x", editedAt: iso() }, id: "z" }), 400, "validation_failed");
  });

  // AC12
  it("answers 404 for edits and deletes of a comment that is gone", async () => {
    const w = await world();
    const c = (await create(w.creator, w.p, w.t)).body;
    expect((await del(w.creator, w.p, w.t, c.id)).status).toBe(204);
    expectError(await patch(w.creator, w.p, w.t, c.id, { text: { value: "x", editedAt: iso() } }), 404, "not_found");
    expectError(await patch(w.creator, w.p, w.t, c.id, { remindWith: { value: true, editedAt: iso() } }), 404, "not_found");
    expectError(await del(w.creator, w.p, w.t, c.id), 404, "not_found");
    expectError(await del(w.creator, w.p, w.t, randomUUID()), 404, "not_found");
  });

  it("does not reach a comment through another task's path", async () => {
    const w = await world();
    const c = (await create(w.creator, w.p, w.t)).body;
    const other = await seedTask(w.p, w.creator.id);
    expectError(await patch(w.creator, w.p, other, c.id, { text: { value: "x", editedAt: iso() } }), 404, "not_found");
    expectError(await del(w.creator, w.p, other, c.id), 404, "not_found");
  });
});
