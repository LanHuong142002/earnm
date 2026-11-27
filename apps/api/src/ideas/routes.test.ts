import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_LIFETIME_MS } from "../auth/sessions.js";
import { createApp } from "../app.js";
import type { PhotoStore } from "../photos/cloudinary.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { destroyWait } from "../photos/destroy.js";
import { MAX_IDEAS_PER_PROJECT } from "./routes.js";

/** An in-memory PhotoStore: no network. `destroyed` lists the public ids it was asked to remove. */
function fakeStore() {
  const destroyed: string[] = [];
  const store: PhotoStore & { hang: boolean } = {
    hang: false,
    cloudName: "demo",
    apiKey: "key123",
    sign: (publicId, timestamp) => `sig(${publicId},${timestamp})`,
    thumbUrl: (publicId) => `https://img.test/thumb/${publicId}`,
    url: (publicId) => `https://img.test/full/${publicId}`,
    copy: async () => ({ width: 1200, height: 900 }),
    async destroy(publicId) {
      destroyed.push(publicId);
      if (store.hang) await new Promise<never>(() => {});
    },
  };
  return { store, destroyed };
}

describe("/projects/:projectId/ideas", () => {
  useTestApp();
  const clock = createClock();
  const { store, destroyed } = fakeStore();
  const app = createApp({ prisma, now: clock.now, photoStore: store });

  afterEach(() => {
    destroyed.length = 0;
    store.hang = false;
  });

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);

  async function seedProject(): Promise<string> {
    const t0 = clock.now();
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0 },
    });
    return project.id;
  }

  async function seedLabel(projectId: string, name: string): Promise<string> {
    const t = clock.now();
    const label = await prisma.label.create({
      data: { id: randomUUID(), projectId, name, nameKey: name.toLowerCase(), colour: "blue", nameEditedAt: t, colourEditedAt: t },
    });
    return label.id;
  }

  /** owner, author and other (members), stranger (not a member). */
  async function world() {
    const owner = await user();
    const author = await user();
    const other = await user();
    const stranger = await user();
    const p = await seedProject();
    await addMember(p, owner.id, "owner");
    await addMember(p, author.id, "member");
    await addMember(p, other.id, "member");
    // Edit times are clamped to server time, so give the tests a past to edit in.
    clock.advanceMs(10_000);
    return { owner, author, other, stranger, p };
  }

  const base = (p: string) => `/projects/${p}/ideas`;
  const create = (u: User, p: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post(base(p))
      .set(...bearer(u.token))
      .send({ id: randomUUID(), title: "Idea", ...body });
  const list = (u: User, p: string) => request(app).get(base(p)).set(...bearer(u.token));
  const get = (u: User, p: string, i: string) => request(app).get(`${base(p)}/${i}`).set(...bearer(u.token));
  const patch = (u: User, p: string, i: string, body: Record<string, unknown>) =>
    request(app).patch(`${base(p)}/${i}`).set(...bearer(u.token)).send(body);
  const del = (u: User, p: string, i: string) => request(app).delete(`${base(p)}/${i}`).set(...bearer(u.token));
  const vote = (u: User, p: string, i: string, value: unknown) =>
    request(app).put(`${base(p)}/${i}/vote`).set(...bearer(u.token)).send({ value });
  const change = (value: unknown, offsetMs = 0) => ({ value, editedAt: iso(offsetMs) });

  async function seedIdea(p: string, authorId: string | null, extra: Record<string, unknown> = {}) {
    const idea = await prisma.idea.create({ data: { id: randomUUID(), projectId: p, authorId, title: "Seed", ...extra } });
    return idea.id;
  }

  async function seedPhoto(p: string, ideaId: string, addedById: string) {
    const id = randomUUID();
    const publicId = `earnm/${p}/ideas/${ideaId}/${id}`;
    await prisma.ideaPhoto.create({ data: { id, ideaId, addedById, publicId, width: 10, height: 10 } });
    return publicId;
  }

  // AC7
  it("answers 401 without a valid session", async () => {
    const w = await world();
    const i = await seedIdea(w.p, w.author.id);
    expectError(await request(app).get(base(w.p)), 401, "not_signed_in");
    expectError(await request(app).get(`${base(w.p)}/${i}`), 401, "not_signed_in");
    expectError(await request(app).post(base(w.p)).send({}), 401, "not_signed_in");
    expectError(await request(app).patch(`${base(w.p)}/${i}`).send({}), 401, "not_signed_in");
    expectError(await request(app).delete(`${base(w.p)}/${i}`), 401, "not_signed_in");
    expectError(await request(app).put(`${base(w.p)}/${i}/vote`).send({ value: 1 }), 401, "not_signed_in");
    clock.advanceMs(SESSION_LIFETIME_MS + 1000);
    expectError(await list(w.author, w.p), 401, "not_signed_in");
  });

  // AC7
  it("answers 404 not_found to a non-member on every route, and for a missing idea", async () => {
    const w = await world();
    const i = await seedIdea(w.p, w.author.id);
    expectError(await list(w.stranger, w.p), 404, "not_found");
    expectError(await get(w.stranger, w.p, i), 404, "not_found");
    expectError(await create(w.stranger, w.p), 404, "not_found");
    expectError(await patch(w.stranger, w.p, i, { status: change("accepted") }), 404, "not_found");
    expectError(await del(w.stranger, w.p, i), 404, "not_found");
    expectError(await vote(w.stranger, w.p, i, 1), 404, "not_found");
    expectError(await get(w.author, w.p, randomUUID()), 404, "not_found");
    expectError(await get(w.author, w.p, "not-a-uuid"), 404, "not_found");
    expectError(await list(w.author, randomUUID()), 404, "not_found");
    expect(await prisma.idea.count()).toBe(1);
  });

  // AC1
  describe("create", () => {
    it("creates a New idea with its author and time, and returns the full shape", async () => {
      const w = await world();
      const label = await seedLabel(w.p, "UI");
      const id = randomUUID();
      const res = await create(w.author, w.p, { id, title: "  Dark mode  ", description: "Looks nicer", labelIds: [label] });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id,
        projectId: w.p,
        author: { id: w.author.id, displayName: "Bob" },
        title: "Dark mode",
        description: "Looks nicer",
        status: "new",
        labelIds: [label],
        score: 0,
        likeCount: 0,
        dislikeCount: 0,
        myVote: 0,
        commentCount: 0,
        photoCount: 0,
        taskId: null,
        task: null,
        createdAt: clock.now().toISOString(),
      });
    });

    it("defaults the description to empty and the labels to none", async () => {
      const w = await world();
      const res = await create(w.author, w.p);
      expect(res.status).toBe(201);
      expect(res.body.description).toBe("");
      expect(res.body.labelIds).toEqual([]);
    });

    it("refuses a bad title, a long description, too many labels, foreign labels and unknown fields", async () => {
      const w = await world();
      const otherProject = await seedProject();
      const foreign = await seedLabel(otherProject, "Foreign");
      const eleven = await Promise.all(Array.from({ length: 11 }, (_, n) => seedLabel(w.p, `L${n}`)));
      const own = await seedLabel(w.p, "Own");
      const bad: Record<string, unknown>[] = [
        { title: "" },
        { title: "   " },
        { title: "x".repeat(121) },
        { title: "line\u0000break" },
        { title: 5 },
        { description: "d".repeat(2001) },
        { labelIds: eleven },
        { labelIds: [foreign] },
        { labelIds: [own, own] },
        { labelIds: ["nope"] },
        { status: "accepted" },
        { surprise: true },
      ];
      for (const body of bad) {
        expectError(await create(w.author, w.p, body), 400, "validation_failed");
      }
      expectError(
        await request(app).post(base(w.p)).set(...bearer(w.author.token)).send({ title: "no id" }),
        400,
        "validation_failed",
      );
      expect(await prisma.idea.count()).toBe(0);
    });

    it("accepts a 120 character title and a 2000 character description", async () => {
      const w = await world();
      const res = await create(w.author, w.p, { title: "t".repeat(120), description: "d".repeat(2000) });
      expect(res.status).toBe(201);
    });

    // AC7
    it("is idempotent: the same id twice answers 200 with one idea; another project's id is a 409", async () => {
      const w = await world();
      const id = randomUUID();
      expect((await create(w.author, w.p, { id })).status).toBe(201);
      const again = await create(w.author, w.p, { id, title: "Different" });
      expect(again.status).toBe(200);
      expect(again.body.title).toBe("Idea");
      expect(await prisma.idea.count()).toBe(1);

      const p2 = await seedProject();
      await addMember(p2, w.author.id, "member");
      expectError(await create(w.author, p2, { id }), 409, "id_conflict");
    });

    it("ignores a differing body on a replay: 200 with the saved idea, nothing overwritten", async () => {
      const w = await world();
      const id = randomUUID();
      await create(w.author, w.p, { id, title: "First", description: "one" });
      const again = await create(w.author, w.p, { id, title: "Second", description: "two", labelIds: [] });
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ title: "First", description: "one" });
      expect(await prisma.idea.findUniqueOrThrow({ where: { id } })).toMatchObject({ title: "First", description: "one" });
    });

    it("handles the same create sent twice at once", async () => {
      const w = await world();
      const id = randomUUID();
      const [a, b] = await Promise.all([create(w.author, w.p, { id }), create(w.author, w.p, { id })]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(await prisma.idea.count()).toBe(1);
    });

    // AC4
    it("refuses the 501st idea with idea_limit_reached", async () => {
      const w = await world();
      await prisma.idea.createMany({
        data: Array.from({ length: MAX_IDEAS_PER_PROJECT }, () => ({
          id: randomUUID(),
          projectId: w.p,
          authorId: w.author.id,
          title: "x",
        })),
      });
      expectError(await create(w.author, w.p), 409, "idea_limit_reached");
      expect(await prisma.idea.count()).toBe(MAX_IDEAS_PER_PROJECT);
      // A retry of an idea that already exists is still answered.
      const existing = await prisma.idea.findFirstOrThrow();
      expect((await create(w.author, w.p, { id: existing.id })).status).toBe(200);
    });
  });

  // AC9
  describe("list and get", () => {
    it("returns the score and only the caller's own vote, with counts and the task", async () => {
      const w = await world();
      const i = await seedIdea(w.p, w.author.id);
      const j = await seedIdea(w.p, w.other.id);
      await vote(w.author, w.p, i, 1);
      await vote(w.other, w.p, i, 1);
      await vote(w.owner, w.p, i, -1);
      await vote(w.other, w.p, j, -1);
      await prisma.ideaComment.create({ data: { id: randomUUID(), ideaId: i, authorId: w.other.id, text: "hi" } });
      await seedPhoto(w.p, i, w.author.id);

      const asAuthor = await list(w.author, w.p);
      expect(asAuthor.status).toBe(200);
      const byId = Object.fromEntries((asAuthor.body.ideas as { id: string }[]).map((x) => [x.id, x]));
      expect(byId[i]).toMatchObject({ score: 1, myVote: 1, commentCount: 1, photoCount: 1 });
      expect(byId[j]).toMatchObject({ score: -1, myVote: 0, commentCount: 0, photoCount: 0 });

      const asOwner = await get(w.owner, w.p, i);
      expect(asOwner.body).toMatchObject({ id: i, score: 1, myVote: -1 });
      expect(JSON.stringify(asOwner.body)).not.toContain(w.other.id);
    });

    it("returns likeCount and dislikeCount from the list, detail and vote routes", async () => {
      const w = await world();
      const i = await seedIdea(w.p, w.author.id);
      await vote(w.author, w.p, i, 1);
      await vote(w.other, w.p, i, 1);
      const last = await vote(w.owner, w.p, i, -1);
      expect(last.body).toMatchObject({ likeCount: 2, dislikeCount: 1, score: 1 });

      const listed = (await list(w.author, w.p)).body.ideas.find((x: { id: string }) => x.id === i);
      expect(listed).toMatchObject({ likeCount: 2, dislikeCount: 1, score: 1 });
      expect((await get(w.other, w.p, i)).body).toMatchObject({ likeCount: 2, dislikeCount: 1, score: 1 });

      const fresh = await seedIdea(w.p, w.author.id);
      expect((await get(w.author, w.p, fresh)).body).toMatchObject({ likeCount: 0, dislikeCount: 0, score: 0 });
    });

    it("lists only this project's ideas", async () => {
      const w = await world();
      const p2 = await seedProject();
      await addMember(p2, w.author.id, "member");
      await seedIdea(w.p, w.author.id);
      const elsewhere = await seedIdea(p2, w.author.id);
      const res = await list(w.author, w.p);
      expect(res.body.ideas).toHaveLength(1);
      expectError(await get(w.author, w.p, elsewhere), 404, "not_found");
    });

    it("shows a neutral null author when the author's account is gone", async () => {
      const w = await world();
      const i = await seedIdea(w.p, w.author.id);
      await prisma.user.delete({ where: { id: w.author.id } });
      const res = await get(w.owner, w.p, i);
      expect(res.body.author).toBeNull();
    });

    it("links the created task", async () => {
      const w = await world();
      const t0 = clock.now();
      const task = await prisma.task.create({
        data: {
          id: randomUUID(), projectId: w.p, title: "Do it", titleEditedAt: t0, descriptionEditedAt: t0,
          statusEditedAt: t0, dueEditedAt: t0, assigneesEditedAt: t0,
        },
      });
      const i = await seedIdea(w.p, w.author.id, { taskId: task.id, status: "accepted" });
      const res = await get(w.author, w.p, i);
      expect(res.body.taskId).toBe(task.id);
      expect(res.body.task).toEqual({ id: task.id, title: "Do it", status: "todo" });
    });
  });

  describe("patch", () => {
    // AC2
    it("lets the author edit title, description and labels, and trims", async () => {
      const w = await world();
      const label = await seedLabel(w.p, "UI");
      const i = (await create(w.author, w.p)).body.id as string;
      const res = await patch(w.author, w.p, i, {
        title: change("  New title "),
        description: change("More"),
        labels: change([label]),
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ title: "New title", description: "More", labelIds: [label] });
    });

    // AC2
    it("lets the project Owner edit someone else's idea", async () => {
      const w = await world();
      const i = (await create(w.author, w.p)).body.id as string;
      const res = await patch(w.owner, w.p, i, { title: change("Owner edit") });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Owner edit");
    });

    // AC2
    it("answers 403 forbidden to another member editing title, description or labels, and changes nothing", async () => {
      const w = await world();
      const label = await seedLabel(w.p, "UI");
      const i = (await create(w.author, w.p)).body.id as string;
      for (const body of [
        { title: change("Nope") },
        { description: change("Nope") },
        { labels: change([label]) },
        // One forbidden field refuses the whole request, even next to a status change.
        { status: change("considering"), title: change("Nope") },
      ]) {
        expectError(await patch(w.other, w.p, i, body), 403, "forbidden");
      }
      const row = await prisma.idea.findUniqueOrThrow({ where: { id: i } });
      expect(row).toMatchObject({ title: "Idea", status: "new" });
    });

    // AC3
    it("lets any member change the status", async () => {
      const w = await world();
      const i = (await create(w.author, w.p)).body.id as string;
      for (const [u, status] of [
        [w.other, "considering"],
        [w.author, "accepted"],
        [w.owner, "dropped"],
        [w.other, "new"],
      ] as const) {
        clock.advanceMs(1000);
        const res = await patch(u, w.p, i, { status: change(status) });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(status);
      }
    });

    it("lets only an Owner edit an idea whose author is gone", async () => {
      const w = await world();
      const i = await seedIdea(w.p, null);
      expectError(await patch(w.author, w.p, i, { title: change("x") }), 403, "forbidden");
      expect((await patch(w.owner, w.p, i, { title: change("x") })).status).toBe(200);
    });

    // AC7
    it("keeps the newer value per field: an older edit loses, other fields still apply", async () => {
      const w = await world();
      const i = (await create(w.author, w.p)).body.id as string;
      expect((await patch(w.author, w.p, i, { title: change("Newer", -1000) })).body.title).toBe("Newer");
      const res = await patch(w.author, w.p, i, {
        title: change("Older", -5000),
        description: change("Fresh", -5000),
      });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Newer");
      expect(res.body.description).toBe("Fresh");
      // Status has its own clock.
      expect((await patch(w.other, w.p, i, { status: change("accepted", -9000) })).body.status).toBe("accepted");
    });

    it("clamps an edit time in the future to the server clock", async () => {
      const w = await world();
      const i = (await create(w.author, w.p)).body.id as string;
      await patch(w.author, w.p, i, { title: change("Future", 60 * 60 * 1000) });
      const res = await patch(w.author, w.p, i, { title: change("Later", 1000) });
      // Both edits are clamped to the same server time, so the second does not beat the first:
      // a phone with a wrong clock cannot win every later conflict.
      expect(res.body.title).toBe("Future");
      const row = await prisma.idea.findUniqueOrThrow({ where: { id: i } });
      expect(row.titleEditedAt.getTime()).toBeLessThanOrEqual(clock.now().getTime());
    });

    it("refuses an unknown label without changing anything", async () => {
      const w = await world();
      const otherProject = await seedProject();
      const foreign = await seedLabel(otherProject, "Foreign");
      const own = await seedLabel(w.p, "Own");
      const i = (await create(w.author, w.p, { labelIds: [own] })).body.id as string;
      expectError(await patch(w.author, w.p, i, { labels: change([foreign]) }), 400, "validation_failed");
      expect((await get(w.author, w.p, i)).body.labelIds).toEqual([own]);
    });

    it("refuses an empty body, bad values and unknown fields", async () => {
      const w = await world();
      const i = (await create(w.author, w.p)).body.id as string;
      for (const body of [
        {},
        { title: change("") },
        { title: change("x".repeat(121)) },
        { description: change("d".repeat(2001)) },
        { status: change("done") },
        { labels: change(Array.from({ length: 11 }, () => randomUUID())) },
        { title: { value: "x" } },
        { surprise: change("x") },
      ]) {
        expectError(await patch(w.author, w.p, i, body), 400, "validation_failed");
      }
    });
  });

  describe("delete", () => {
    // AC2
    it("lets the author and the Owner delete, and refuses another member", async () => {
      const w = await world();
      const a = (await create(w.author, w.p)).body.id as string;
      const b = (await create(w.author, w.p)).body.id as string;
      expectError(await del(w.other, w.p, a), 403, "forbidden");
      expect((await del(w.author, w.p, a)).status).toBe(204);
      expect((await del(w.owner, w.p, b)).status).toBe(204);
      expect(await prisma.idea.count()).toBe(0);
      expectError(await del(w.author, w.p, a), 404, "not_found");
    });

    it("still answers 204 when the image store never answers", async () => {
      const w = await world();
      const i = await seedIdea(w.p, w.author.id);
      await seedPhoto(w.p, i, w.author.id);
      store.hang = true;
      const saved = destroyWait.ms;
      destroyWait.ms = 50;
      try {
        expect((await del(w.author, w.p, i)).status).toBe(204);
      } finally {
        destroyWait.ms = saved;
      }
      expect(await prisma.idea.count({ where: { id: i } })).toBe(0);
      expect(destroyed.length).toBe(1);
    });

    it("lets only an Owner delete an idea whose author is gone", async () => {
      const w = await world();
      const i = await seedIdea(w.p, null);
      expectError(await del(w.author, w.p, i), 403, "forbidden");
      expect((await del(w.owner, w.p, i)).status).toBe(204);
    });

    // AC5
    it("deletes comments, votes and photo rows, destroys the images, and leaves a created task", async () => {
      const w = await world();
      const t0 = clock.now();
      const task = await prisma.task.create({
        data: {
          id: randomUUID(), projectId: w.p, title: "Kept", titleEditedAt: t0, descriptionEditedAt: t0,
          statusEditedAt: t0, dueEditedAt: t0, assigneesEditedAt: t0,
        },
      });
      const i = await seedIdea(w.p, w.author.id, { taskId: task.id, status: "accepted" });
      await vote(w.other, w.p, i, 1);
      await prisma.ideaComment.create({ data: { id: randomUUID(), ideaId: i, authorId: w.other.id, text: "hi" } });
      const a = await seedPhoto(w.p, i, w.author.id);
      const b = await seedPhoto(w.p, i, w.author.id);
      const untouched = await seedIdea(w.p, w.author.id);
      const keepPhoto = await seedPhoto(w.p, untouched, w.author.id);

      expect((await del(w.author, w.p, i)).status).toBe(204);
      await vi.waitFor(() => expect(destroyed.length).toBe(2));
      expect(destroyed.sort()).toEqual([a, b].sort());
      expect(destroyed).not.toContain(keepPhoto);
      expect(await prisma.ideaComment.count({ where: { ideaId: i } })).toBe(0);
      expect(await prisma.ideaVote.count({ where: { ideaId: i } })).toBe(0);
      expect(await prisma.ideaPhoto.count({ where: { ideaId: i } })).toBe(0);
      expect(await prisma.ideaPhoto.count({ where: { ideaId: untouched } })).toBe(1);
      expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
    });

    it("destroys no image when the delete is refused", async () => {
      const w = await world();
      const i = await seedIdea(w.p, w.author.id);
      await seedPhoto(w.p, i, w.author.id);
      expectError(await del(w.other, w.p, i), 403, "forbidden");
      await new Promise((r) => setTimeout(r, 20));
      expect(destroyed).toEqual([]);
      expect(await prisma.ideaPhoto.count()).toBe(1);
    });

    // AC5
    it("destroys every idea image when the project is deleted", async () => {
      const w = await world();
      const i = await seedIdea(w.p, w.author.id);
      const j = await seedIdea(w.p, w.other.id);
      const a = await seedPhoto(w.p, i, w.author.id);
      const b = await seedPhoto(w.p, j, w.other.id);
      const res = await request(app).delete(`/projects/${w.p}`).set(...bearer(w.owner.token));
      expect(res.status).toBe(204);
      await vi.waitFor(() => expect(destroyed.length).toBe(2));
      expect(destroyed.sort()).toEqual([a, b].sort());
      expect(await prisma.idea.count()).toBe(0);
      expect(await prisma.ideaPhoto.count()).toBe(0);
    });
  });

  // AC6
  it("drops a deleted label from the ideas that carried it", async () => {
    const w = await world();
    const label = await seedLabel(w.p, "UI");
    const keep = await seedLabel(w.p, "Keep");
    const i = (await create(w.author, w.p, { labelIds: [label, keep] })).body.id as string;
    const res = await request(app).delete(`/projects/${w.p}/labels/${label}`).set(...bearer(w.owner.token));
    expect(res.status).toBe(204);
    expect((await get(w.author, w.p, i)).body.labelIds).toEqual([keep]);
  });

  // AC8
  describe("vote", () => {
    it("sets, switches and removes a vote, on your own idea too", async () => {
      const w = await world();
      const i = (await create(w.author, w.p)).body.id as string;

      let res = await vote(w.author, w.p, i, 1);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: i, score: 1, myVote: 1 });

      res = await vote(w.other, w.p, i, 1);
      expect(res.body).toMatchObject({ score: 2, myVote: 1 });

      res = await vote(w.other, w.p, i, -1);
      expect(res.body).toMatchObject({ score: 0, myVote: -1 });

      res = await vote(w.other, w.p, i, 0);
      expect(res.body).toMatchObject({ score: 1, myVote: 0 });
      expect(await prisma.ideaVote.count({ where: { ideaId: i } })).toBe(1);

      // Removing a vote that isn't there is fine.
      res = await vote(w.other, w.p, i, 0);
      expect(res.status).toBe(200);
      // The same vote twice stays one vote.
      await vote(w.owner, w.p, i, -1);
      res = await vote(w.owner, w.p, i, -1);
      expect(res.body).toMatchObject({ score: 0, myVote: -1 });
    });

    it("refuses a value other than -1, 0 or 1 and unknown fields", async () => {
      const w = await world();
      const i = (await create(w.author, w.p)).body.id as string;
      for (const value of [2, -2, 0.5, "1", null, true]) {
        expectError(await vote(w.author, w.p, i, value), 400, "validation_failed");
      }
      expectError(
        await request(app).put(`${base(w.p)}/${i}/vote`).set(...bearer(w.author.token)).send({ value: 1, extra: 1 }),
        400,
        "validation_failed",
      );
      expect(await prisma.ideaVote.count()).toBe(0);
    });

    it("keeps the votes of a member who was removed from the project", async () => {
      const w = await world();
      const i = (await create(w.author, w.p)).body.id as string;
      await vote(w.other, w.p, i, 1);
      await prisma.projectMember.delete({ where: { projectId_userId: { projectId: w.p, userId: w.other.id } } });
      const res = await get(w.author, w.p, i);
      expect(res.body.score).toBe(1);
      expectError(await get(w.other, w.p, i), 404, "not_found");
    });

    it("is not allowed once the voter is no longer a member", async () => {
      const w = await world();
      const i = (await create(w.author, w.p)).body.id as string;
      await prisma.projectMember.delete({ where: { projectId_userId: { projectId: w.p, userId: w.other.id } } });
      expectError(await vote(w.other, w.p, i, 1), 404, "not_found");
    });
  });
});
