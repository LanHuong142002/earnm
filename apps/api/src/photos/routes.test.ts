import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_LIFETIME_MS } from "../auth/sessions.js";
import { errorHandler, notFoundHandler } from "../http/errors.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { createProjectsRouter } from "../projects/routes.js";
import { createTasksRouter } from "../tasks/routes.js";
import type { PhotoStore } from "./cloudinary.js";
import { createPhotosRouter, MAX_CAPTION_LENGTH, MAX_PHOTOS_PER_TASK } from "./routes.js";

const SECRET = "fake-api-secret-must-never-leak";

/** An in-memory PhotoStore: no network. `destroyed` lists the public ids it was asked to remove. */
function fakeStore() {
  const destroyed: string[] = [];
  const store: PhotoStore & { failDestroy: boolean } = {
    cloudName: "demo",
    apiKey: "key123",
    failDestroy: false,
    sign: (publicId, timestamp) => `sig(${publicId},${timestamp})`,
    thumbUrl: (publicId) => `https://img.test/thumb/${publicId}`,
    url: (publicId) => `https://img.test/full/${publicId}`,
    copy: async () => ({ width: 1200, height: 900 }),
    async destroy(publicId) {
      destroyed.push(publicId);
      if (store.failDestroy) throw new Error(`boom with ${SECRET}`);
    },
  };
  return { store, destroyed };
}

describe("/projects/:projectId/tasks/:taskId/photos", () => {
  useTestApp();
  const clock = createClock();
  const { store, destroyed } = fakeStore();

  function buildApp(photoStore: PhotoStore | null) {
    const deps = { prisma, now: clock.now, photoStore };
    const a = express();
    a.use(express.json({ limit: "10kb" }));
    a.use("/projects/:projectId/tasks/:taskId/photos", createPhotosRouter(deps));
    a.use("/projects/:projectId/tasks", createTasksRouter(deps));
    a.use("/projects", createProjectsRouter(deps));
    a.use(notFoundHandler);
    a.use(errorHandler);
    return a;
  }
  const app = buildApp(store);
  const appOff = buildApp(null);

  afterEach(() => {
    destroyed.length = 0;
    store.failDestroy = false;
  });

  /** Destroys run in the background after the answer: wait until the fake has been asked. */
  const destroyedCount = (n: number) => vi.waitFor(() => expect(destroyed.length).toBeGreaterThanOrEqual(n));

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

  /** owner (not involved), creator and assignee (involved), bystander (member, not involved), stranger (not a member). */
  async function world() {
    const owner = await user();
    const creator = await user();
    const assignee = await user();
    const bystander = await user();
    const stranger = await user();
    const t0 = clock.now();
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0 },
    });
    await addMember(project.id, owner.id, "owner");
    for (const m of [creator, assignee, bystander]) await addMember(project.id, m.id, "member");
    const p = project.id;
    const t = await seedTask(p, creator.id, [assignee.id]);
    // Edit times are clamped to server time, so give the tests a past to edit in.
    clock.advanceMs(10_000);
    return { owner, creator, assignee, bystander, stranger, p, t };
  }

  const base = (p: string, t: string) => `/projects/${p}/tasks/${t}/photos`;
  const publicIdOf = (p: string, t: string, id: string) => `earnm/${p}/${t}/${id}`;
  const sign = (u: User, p: string, t: string, body: Record<string, unknown> = { id: randomUUID() }, a = app) =>
    request(a).post(`${base(p, t)}/sign`).set(...bearer(u.token)).send(body);
  const record = (u: User, p: string, t: string, body: Record<string, unknown> = {}, a = app) => {
    const id = (body["id"] as string | undefined) ?? randomUUID();
    return request(a)
      .post(base(p, t))
      .set(...bearer(u.token))
      .send({ id, publicId: publicIdOf(p, t, id), width: 1200, height: 900, ...body });
  };
  const list = (u: User, p: string, t: string, a = app) => request(a).get(base(p, t)).set(...bearer(u.token));
  const patch = (u: User, p: string, t: string, photo: string, body: Record<string, unknown>) =>
    request(app)
      .patch(`${base(p, t)}/${photo}`)
      .set(...bearer(u.token))
      .send(body);
  const del = (u: User, p: string, t: string, photo: string) =>
    request(app).delete(`${base(p, t)}/${photo}`).set(...bearer(u.token));
  const captionBody = (value: string, offsetMs = 0) => ({ caption: { value, editedAt: iso(offsetMs) } });

  async function fillTask(w: { p: string; t: string; creator: User }, count: number) {
    await prisma.taskPhoto.createMany({
      data: Array.from({ length: count }, () => {
        const id = randomUUID();
        return { id, taskId: w.t, addedById: w.creator.id, publicId: publicIdOf(w.p, w.t, id), width: 10, height: 10 };
      }),
    });
  }

  // AC12
  it("answers 401 without a valid session", async () => {
    const w = await world();
    expectError(await request(app).get(base(w.p, w.t)), 401, "not_signed_in");
    expectError(await request(app).post(base(w.p, w.t)).send({}), 401, "not_signed_in");
    expectError(await request(app).post(`${base(w.p, w.t)}/sign`).send({}), 401, "not_signed_in");
    clock.advanceMs(SESSION_LIFETIME_MS + 1000);
    expectError(await list(w.creator, w.p, w.t), 401, "not_signed_in");
  });

  // AC12
  it("answers 404 not_found to a non-member on every route", async () => {
    const w = await world();
    const photo = (await record(w.creator, w.p, w.t)).body;
    expectError(await list(w.stranger, w.p, w.t), 404, "not_found");
    expectError(await sign(w.stranger, w.p, w.t), 404, "not_found");
    expectError(await record(w.stranger, w.p, w.t), 404, "not_found");
    expectError(await patch(w.stranger, w.p, w.t, photo.id, captionBody("x")), 404, "not_found");
    expectError(await del(w.stranger, w.p, w.t, photo.id), 404, "not_found");
    expectError(await list(w.creator, w.p, randomUUID()), 404, "not_found");
    expect(destroyed).toEqual([]);
  });

  // AC9
  it("signs one upload with the fixed public id and type, and never returns the secret", async () => {
    const w = await world();
    const id = randomUUID();
    const res = await sign(w.assignee, w.p, w.t, { id });
    expect(res.status).toBe(200);
    const publicId = publicIdOf(w.p, w.t, id);
    const timestamp = Math.floor(clock.now().getTime() / 1000);
    expect(res.body).toEqual({
      cloudName: "demo",
      apiKey: "key123",
      timestamp,
      signature: `sig(${publicId},${timestamp})`,
      publicId,
      type: "authenticated",
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expectError(await sign(w.creator, w.p, w.t, { id, extra: 1 }), 400, "validation_failed");
    expectError(await sign(w.creator, w.p, w.t, { id: "nope" }), 400, "validation_failed");
  });

  // AC7, AC9
  it("refuses sign, record, caption and delete to a member who isn't involved", async () => {
    const w = await world();
    const photo = (await record(w.creator, w.p, w.t)).body;
    for (const other of [w.bystander, w.owner]) {
      expectError(await sign(other, w.p, w.t), 403, "forbidden");
      expectError(await record(other, w.p, w.t), 403, "forbidden");
      expectError(await patch(other, w.p, w.t, photo.id, captionBody("x")), 403, "forbidden");
      expectError(await del(other, w.p, w.t, photo.id), 403, "forbidden");
    }
    // They can still see it (requirement 7).
    expect((await list(w.bystander, w.p, w.t)).body.photos).toHaveLength(1);
    expect(destroyed).toEqual([]);
  });

  // AC4, AC10
  it("records a photo with who added it and when, and lists it with signed URLs", async () => {
    const w = await world();
    const id = randomUUID();
    const res = await record(w.assignee, w.p, w.t, { id, caption: "  Receipt  " });
    expect(res.status).toBe(201);
    const publicId = publicIdOf(w.p, w.t, id);
    expect(res.body).toEqual({
      id,
      taskId: w.t,
      addedBy: { id: w.assignee.id, displayName: "Bob" },
      caption: "Receipt",
      width: 1200,
      height: 900,
      createdAt: clock.now().toISOString(),
      thumbUrl: `https://img.test/thumb/${publicId}`,
      url: `https://img.test/full/${publicId}`,
    });
    const listed = await list(w.bystander, w.p, w.t);
    expect(listed.status).toBe(200);
    expect(listed.body.photos).toEqual([res.body]);
    expect(JSON.stringify(listed.body)).not.toContain(SECRET);
  });

  // AC10
  it("lists photos oldest first", async () => {
    const w = await world();
    const a = await record(w.creator, w.p, w.t);
    clock.advanceMs(1000);
    const b = await record(w.assignee, w.p, w.t);
    const ids = (await list(w.owner, w.p, w.t)).body.photos.map((x: { id: string }) => x.id);
    expect(ids).toEqual([a.body.id, b.body.id]);
  });

  // AC11
  it("lists only recorded photos, not ones that were only signed", async () => {
    const w = await world();
    await sign(w.creator, w.p, w.t);
    expect((await list(w.creator, w.p, w.t)).body.photos).toEqual([]);
  });

  // AC14
  it("records the same id twice on a task as one photo, and refuses it on another task", async () => {
    const w = await world();
    const id = randomUUID();
    expect((await record(w.creator, w.p, w.t, { id })).status).toBe(201);
    const again = await record(w.creator, w.p, w.t, { id });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(id);
    expect(await prisma.taskPhoto.count({ where: { taskId: w.t } })).toBe(1);

    const otherTask = await seedTask(w.p, w.creator.id);
    expectError(
      await request(app)
        .post(base(w.p, otherTask))
        .set(...bearer(w.creator.token))
        .send({ id, publicId: publicIdOf(w.p, otherTask, id), width: 1, height: 1 }),
      409,
      "id_conflict",
    );
    expectError(await sign(w.creator, w.p, otherTask, { id }), 409, "id_conflict");
  });

  // AC9
  it("refuses a public id that isn't exactly the derived one", async () => {
    const w = await world();
    const id = randomUUID();
    const otherTask = await seedTask(w.p, w.creator.id);
    for (const publicId of [
      "someone/else",
      publicIdOf(w.p, otherTask, id),
      `${publicIdOf(w.p, w.t, id)}/extra`,
      publicIdOf(w.p, w.t, randomUUID()),
    ]) {
      expectError(await record(w.creator, w.p, w.t, { id, publicId }), 400, "validation_failed");
    }
    expect(await prisma.taskPhoto.count()).toBe(0);
  });

  it("rejects bad bodies with validation_failed", async () => {
    const w = await world();
    expectError(await record(w.creator, w.p, w.t, { extra: 1 }), 400, "validation_failed");
    expectError(await record(w.creator, w.p, w.t, { id: "nope" }), 400, "validation_failed");
    expectError(await record(w.creator, w.p, w.t, { width: 0 }), 400, "validation_failed");
    expectError(await record(w.creator, w.p, w.t, { height: 1.5 }), 400, "validation_failed");
    expectError(await record(w.creator, w.p, w.t, { width: "10" }), 400, "validation_failed");
  });

  // AC2
  it("refuses signing and recording once a task holds 10 photos, with photo_limit_reached", async () => {
    const w = await world();
    await fillTask(w, MAX_PHOTOS_PER_TASK - 1);
    expect((await sign(w.creator, w.p, w.t)).status).toBe(200);
    expect((await record(w.creator, w.p, w.t)).status).toBe(201);
    expectError(await sign(w.creator, w.p, w.t), 409, "photo_limit_reached");
    expectError(await record(w.creator, w.p, w.t), 409, "photo_limit_reached");
    expect(await prisma.taskPhoto.count({ where: { taskId: w.t } })).toBe(10);
  });

  it("destroys the uploaded image when a record is refused for the limit or because the task is gone", async () => {
    const w = await world();
    await fillTask(w, MAX_PHOTOS_PER_TASK);
    const id = randomUUID();
    expectError(await record(w.creator, w.p, w.t, { id }), 409, "photo_limit_reached");
    await destroyedCount(1);
    expect(destroyed).toEqual([publicIdOf(w.p, w.t, id)]);

    destroyed.length = 0;
    const w2 = await world();
    const id2 = randomUUID();
    expect((await sign(w2.creator, w2.p, w2.t, { id: id2 })).status).toBe(200);
    await prisma.task.delete({ where: { id: w2.t } });
    expectError(await record(w2.creator, w2.p, w2.t, { id: id2 }), 404, "not_found");
    await destroyedCount(1);
    expect(destroyed).toEqual([publicIdOf(w2.p, w2.t, id2)]);

    // A person who is not a member can't make the server destroy anything.
    destroyed.length = 0;
    expectError(await record(w2.stranger, w2.p, w2.t, { id: id2 }), 404, "not_found");
    expect(destroyed).toEqual([]);
  });

  it("still answers a retried record of an existing photo when the task is full", async () => {
    const w = await world();
    await fillTask(w, MAX_PHOTOS_PER_TASK - 1);
    const id = randomUUID();
    expect((await record(w.creator, w.p, w.t, { id })).status).toBe(201);
    expect((await record(w.creator, w.p, w.t, { id })).status).toBe(200);
  });

  // AC6
  it("sets, changes and clears a caption, and refuses 201 characters", async () => {
    const w = await world();
    const photo = (await record(w.creator, w.p, w.t)).body;
    expect(photo.caption).toBe("");
    const set = await patch(w.assignee, w.p, w.t, photo.id, captionBody("  Cup sample ", -5000));
    expect(set.status).toBe(200);
    expect(set.body.caption).toBe("Cup sample");
    const changed = await patch(w.creator, w.p, w.t, photo.id, captionBody("Cup 2", -4000));
    expect(changed.body.caption).toBe("Cup 2");
    const cleared = await patch(w.creator, w.p, w.t, photo.id, captionBody("   ", -3000));
    expect(cleared.status).toBe(200);
    expect(cleared.body.caption).toBe("");
    expectError(
      await patch(w.creator, w.p, w.t, photo.id, captionBody("a".repeat(MAX_CAPTION_LENGTH + 1), -2000)),
      400,
      "validation_failed",
    );
    const longest = await patch(w.creator, w.p, w.t, photo.id, captionBody("ế".repeat(MAX_CAPTION_LENGTH), -2000));
    expect(longest.status).toBe(200);
    expectError(await record(w.creator, w.p, w.t, { caption: "a".repeat(MAX_CAPTION_LENGTH + 1) }), 400, "validation_failed");
    expect((await record(w.creator, w.p, w.t, { caption: "a".repeat(MAX_CAPTION_LENGTH) })).status).toBe(201);
    expectError(await patch(w.creator, w.p, w.t, photo.id, {}), 400, "validation_failed");
    expectError(await patch(w.creator, w.p, w.t, photo.id, { ...captionBody("x"), extra: 1 }), 400, "validation_failed");
  });

  // AC13
  it("does not let an older caption edit overwrite a newer one; a deleted photo is 404", async () => {
    const w = await world();
    const photo = (await record(w.creator, w.p, w.t)).body;
    await patch(w.creator, w.p, w.t, photo.id, captionBody("new", -1000));
    const old = await patch(w.creator, w.p, w.t, photo.id, captionBody("old", -5000));
    expect(old.status).toBe(200);
    expect(old.body.caption).toBe("new");
    expect((await del(w.creator, w.p, w.t, photo.id)).status).toBe(204);
    expectError(await patch(w.creator, w.p, w.t, photo.id, captionBody("late", -100)), 404, "not_found");
    expectError(await del(w.creator, w.p, w.t, photo.id), 404, "not_found");
    expectError(await patch(w.creator, w.p, w.t, randomUUID(), captionBody("x", -100)), 404, "not_found");
  });

  it("lets a caption edit queued before the create reached us win over the create", async () => {
    const w = await world();
    const id = randomUUID();
    await record(w.creator, w.p, w.t, { id });
    const res = await patch(w.creator, w.p, w.t, id, captionBody("queued", -9000));
    expect(res.body.caption).toBe("queued");
  });

  // AC5
  it("deletes a photo for an involved person and destroys its Cloudinary image", async () => {
    const w = await world();
    const photo = (await record(w.creator, w.p, w.t)).body;
    const other = (await record(w.creator, w.p, w.t)).body;
    expect((await del(w.assignee, w.p, w.t, photo.id)).status).toBe(204);
    await destroyedCount(1);
    expect(destroyed).toEqual([publicIdOf(w.p, w.t, photo.id)]);
    const left = (await list(w.creator, w.p, w.t)).body.photos.map((x: { id: string }) => x.id);
    expect(left).toEqual([other.id]);
  });

  it("answers 204 and logs when the Cloudinary destroy fails, without leaking the error", async () => {
    const w = await world();
    const photo = (await record(w.creator, w.p, w.t)).body;
    store.failDestroy = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await del(w.creator, w.p, w.t, photo.id);
      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect(await prisma.taskPhoto.count({ where: { taskId: w.t } })).toBe(0);
      await vi.waitFor(() => expect(log).toHaveBeenCalled());
      expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
    } finally {
      log.mockRestore();
    }
  });

  it("answers 204 before the Cloudinary destroy finishes", async () => {
    const w = await world();
    const photo = (await record(w.creator, w.p, w.t)).body;
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const original = store.destroy;
    store.destroy = async (publicId) => {
      await original(publicId);
      await slow;
    };
    try {
      expect((await del(w.creator, w.p, w.t, photo.id)).status).toBe(204);
      await destroyedCount(1);
    } finally {
      release();
      store.destroy = original;
    }
  });

  // AC8
  it("deleting a task removes its photo rows and destroys each image", async () => {
    const w = await world();
    const a = (await record(w.creator, w.p, w.t)).body;
    const b = (await record(w.assignee, w.p, w.t)).body;
    const res = await request(app).delete(`/projects/${w.p}/tasks/${w.t}`).set(...bearer(w.creator.token));
    expect(res.status).toBe(204);
    expect(await prisma.taskPhoto.count()).toBe(0);
    await destroyedCount(2);
    expect([...destroyed].sort()).toEqual([publicIdOf(w.p, w.t, a.id), publicIdOf(w.p, w.t, b.id)].sort());
  });

  it("deleting a task still succeeds when a destroy fails, and a refused delete destroys nothing", async () => {
    const w = await world();
    await record(w.creator, w.p, w.t);
    expectError(
      await request(app).delete(`/projects/${w.p}/tasks/${w.t}`).set(...bearer(w.bystander.token)),
      403,
      "forbidden",
    );
    expect(destroyed).toEqual([]);
    expect(await prisma.taskPhoto.count()).toBe(1);
    store.failDestroy = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await request(app).delete(`/projects/${w.p}/tasks/${w.t}`).set(...bearer(w.creator.token));
      expect(res.status).toBe(204);
      await vi.waitFor(() => expect(log).toHaveBeenCalled());
      expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
    } finally {
      log.mockRestore();
    }
  });

  it("deleting a project destroys the images of all its tasks, and a refused delete destroys nothing", async () => {
    const w = await world();
    const t2 = await seedTask(w.p, w.creator.id);
    const a = (await record(w.creator, w.p, w.t)).body;
    const b = (await record(w.creator, w.p, t2)).body;
    expectError(
      await request(app).delete(`/projects/${w.p}`).set(...bearer(w.creator.token)),
      403,
      "forbidden",
    );
    expect(destroyed).toEqual([]);
    expect(await prisma.taskPhoto.count()).toBe(2);
    const res = await request(app).delete(`/projects/${w.p}`).set(...bearer(w.owner.token));
    expect(res.status).toBe(204);
    expect(await prisma.taskPhoto.count()).toBe(0);
    await destroyedCount(2);
    expect([...destroyed].sort()).toEqual([publicIdOf(w.p, w.t, a.id), publicIdOf(w.p, t2, b.id)].sort());
  });

  it("deleting a project still succeeds when a destroy fails, and without a store", async () => {
    const w = await world();
    await record(w.creator, w.p, w.t);
    store.failDestroy = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await request(app).delete(`/projects/${w.p}`).set(...bearer(w.owner.token));
      expect(res.status).toBe(204);
      await vi.waitFor(() => expect(log).toHaveBeenCalled());
      expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
    } finally {
      log.mockRestore();
    }
    const w2 = await world();
    await fillTask(w2, 2);
    const off = await request(appOff).delete(`/projects/${w2.p}`).set(...bearer(w2.owner.token));
    expect(off.status).toBe(204);
  });

  // AC30
  it("answers photos_unavailable (503) without Cloudinary while task routes still work", async () => {
    const w = await world();
    expectError(await list(w.creator, w.p, w.t, appOff), 503, "photos_unavailable");
    expectError(await sign(w.creator, w.p, w.t, { id: randomUUID() }, appOff), 503, "photos_unavailable");
    expectError(await record(w.creator, w.p, w.t, {}, appOff), 503, "photos_unavailable");
    expectError(
      await request(appOff).patch(`${base(w.p, w.t)}/${randomUUID()}`).set(...bearer(w.creator.token)).send(captionBody("x")),
      503,
      "photos_unavailable",
    );
    expectError(
      await request(appOff).delete(`${base(w.p, w.t)}/${randomUUID()}`).set(...bearer(w.creator.token)),
      503,
      "photos_unavailable",
    );
    // Still signed-in only.
    expectError(await request(appOff).get(base(w.p, w.t)), 401, "not_signed_in");
    const tasks = await request(appOff).get(`/projects/${w.p}/tasks`).set(...bearer(w.creator.token));
    expect(tasks.status).toBe(200);
    const gone = await request(appOff).delete(`/projects/${w.p}/tasks/${w.t}`).set(...bearer(w.creator.token));
    expect(gone.status).toBe(204);
  });
});
