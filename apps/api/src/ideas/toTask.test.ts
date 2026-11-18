import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { PhotoStore } from "../photos/cloudinary.js";
import { MAX_TASKS_PER_PROJECT } from "../tasks/routes.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";

const store: PhotoStore = {
  cloudName: "demo",
  apiKey: "key123",
  sign: () => "sig",
  thumbUrl: (id) => `https://img.test/thumb/${id}`,
  url: (id) => `https://img.test/full/${id}`,
  async destroy() {},
};

describe("POST /projects/:projectId/ideas/:ideaId/task", () => {
  useTestApp();
  const clock = createClock();
  const app = createApp({ prisma, now: clock.now, photoStore: store });

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  type User = { id: string; token: string };

  async function world(status: "new" | "considering" | "accepted" | "dropped" = "accepted") {
    const owner = await createSignedInUser(clock);
    const author = await createSignedInUser(clock);
    const other = await createSignedInUser(clock);
    const stranger = await createSignedInUser(clock);
    const t0 = clock.now();
    const p = (
      await prisma.project.create({
        data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0 },
      })
    ).id;
    await addMember(p, owner.id, "owner");
    await addMember(p, author.id, "member");
    await addMember(p, other.id, "member");
    const label = (
      await prisma.label.create({
        data: { id: randomUUID(), projectId: p, name: "UI", nameKey: "ui", colour: "blue", nameEditedAt: t0, colourEditedAt: t0 },
      })
    ).id;
    const i = (
      await prisma.idea.create({
        data: {
          id: randomUUID(), projectId: p, authorId: author.id, title: "Dark mode", description: "Looks nicer",
          status, labels: { create: [{ labelId: label }] },
        },
      })
    ).id;
    // A photo on the idea: it must not reach the task.
    await prisma.ideaPhoto.create({
      data: { id: randomUUID(), ideaId: i, addedById: author.id, publicId: `earnm/${p}/ideas/${i}/x`, width: 1, height: 1 },
    });
    return { owner, author, other, stranger, p, i, label };
  }

  const toTask = (u: User, p: string, i: string, body: Record<string, unknown> = { taskId: randomUUID() }) =>
    request(app).post(`/projects/${p}/ideas/${i}/task`).set(...bearer(u.token)).send(body);

  it("answers 401 signed out and 404 to a non-member or a missing idea", async () => {
    const w = await world();
    expectError(await request(app).post(`/projects/${w.p}/ideas/${w.i}/task`).send({ taskId: randomUUID() }), 401, "not_signed_in");
    expectError(await toTask(w.stranger, w.p, w.i), 404, "not_found");
    expectError(await toTask(w.author, w.p, randomUUID()), 404, "not_found");
  });

  it("creates the task from an accepted idea with title, description and labels, and links both ways", async () => {
    const w = await world();
    const taskId = randomUUID();
    const res = await toTask(w.other, w.p, w.i, { taskId });
    expect(res.status).toBe(201);
    expect(res.body.task).toMatchObject({
      id: taskId,
      projectId: w.p,
      title: "Dark mode",
      description: "Looks nicer",
      status: "todo",
      labelIds: [w.label],
      assignees: [],
      checklists: [],
      dueDate: null,
      createdById: w.other.id,
      fromIdea: { id: w.i, title: "Dark mode" },
    });
    expect(res.body.idea).toMatchObject({
      id: w.i,
      status: "accepted",
      taskId,
      task: { id: taskId, title: "Dark mode", status: "todo" },
    });
    // No photos copied to the task (#43).
    expect(await prisma.taskPhoto.count({ where: { taskId } })).toBe(0);
    expect(await prisma.ideaPhoto.count({ where: { ideaId: w.i } })).toBe(1);
    expect(await prisma.idea.findUniqueOrThrow({ where: { id: w.i } })).toMatchObject({ taskId });

    // The task list and the single-task answers carry the back-link too.
    const tasks = await request(app).get(`/projects/${w.p}/tasks`).set(...bearer(w.author.token));
    expect(tasks.body[0].fromIdea).toEqual({ id: w.i, title: "Dark mode" });
  });

  it("refuses an idea that is not accepted, with idea_not_accepted, and creates nothing", async () => {
    for (const status of ["new", "considering", "dropped"] as const) {
      const w = await world(status);
      expectError(await toTask(w.author, w.p, w.i), 409, "idea_not_accepted");
      expect(await prisma.task.count()).toBe(0);
    }
  });

  it("refuses a second task for the same idea with idea_already_has_task", async () => {
    const w = await world();
    expect((await toTask(w.author, w.p, w.i)).status).toBe(201);
    expectError(await toTask(w.owner, w.p, w.i), 409, "idea_already_has_task");
    expect(await prisma.task.count()).toBe(1);
  });

  it("allows only one of two simultaneous requests", async () => {
    const w = await world();
    const [a, b] = await Promise.all([toTask(w.author, w.p, w.i), toTask(w.owner, w.p, w.i)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.task.count()).toBe(1);
  });

  it("refuses a bad body and a task id that is already taken", async () => {
    const w = await world();
    for (const body of [{}, { taskId: "nope" }, { taskId: randomUUID(), extra: 1 }]) {
      expectError(await toTask(w.author, w.p, w.i, body), 400, "validation_failed");
    }
    const t0 = clock.now();
    const taken = (
      await prisma.task.create({
        data: { id: randomUUID(), projectId: w.p, title: "T", titleEditedAt: t0, descriptionEditedAt: t0, statusEditedAt: t0, dueEditedAt: t0, assigneesEditedAt: t0 },
      })
    ).id;
    expectError(await toTask(w.author, w.p, w.i, { taskId: taken }), 409, "id_conflict");
    expect((await prisma.idea.findUniqueOrThrow({ where: { id: w.i } })).taskId).toBeNull();
  });

  it("respects the project's task limit and leaves the idea unlinked", async () => {
    const w = await world();
    const t0 = clock.now();
    await prisma.task.createMany({
      data: Array.from({ length: MAX_TASKS_PER_PROJECT }, () => ({
        id: randomUUID(), projectId: w.p, title: "T", titleEditedAt: t0, descriptionEditedAt: t0,
        statusEditedAt: t0, dueEditedAt: t0, assigneesEditedAt: t0,
      })),
    });
    expectError(await toTask(w.author, w.p, w.i), 409, "task_limit_reached");
    expect((await prisma.idea.findUniqueOrThrow({ where: { id: w.i } })).taskId).toBeNull();
    expect(await prisma.task.count()).toBe(MAX_TASKS_PER_PROJECT);
  });

  // AC14
  it("clears the idea's link when the task is deleted, and the task's back-link when the idea is deleted", async () => {
    const w = await world();
    const taskId = (await toTask(w.author, w.p, w.i)).body.task.id as string;
    const del = await request(app).delete(`/projects/${w.p}/tasks/${taskId}`).set(...bearer(w.owner.token));
    expect(del.status).toBe(204);
    const idea = await request(app).get(`/projects/${w.p}/ideas/${w.i}`).set(...bearer(w.author.token));
    expect(idea.body).toMatchObject({ taskId: null, task: null, status: "accepted" });

    // A new task can be made again once the link is gone.
    const again = await toTask(w.author, w.p, w.i);
    expect(again.status).toBe(201);
    const newTaskId = again.body.task.id as string;
    expect((await request(app).delete(`/projects/${w.p}/ideas/${w.i}`).set(...bearer(w.owner.token))).status).toBe(204);
    const task = await request(app).get(`/projects/${w.p}/tasks`).set(...bearer(w.author.token));
    expect(task.body).toHaveLength(1);
    expect(task.body[0]).toMatchObject({ id: newTaskId, fromIdea: null });
  });

  it("gives fromIdea null for a task that did not come from an idea", async () => {
    const w = await world();
    const res = await request(app)
      .post(`/projects/${w.p}/tasks`)
      .set(...bearer(w.author.token))
      .send({ id: randomUUID(), title: "Plain", editedAt: new Date(clock.now().getTime() - 1000).toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.fromIdea).toBeNull();
  });
});
