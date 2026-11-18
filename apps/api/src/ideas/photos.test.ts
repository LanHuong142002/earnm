import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_LIFETIME_MS } from "../auth/sessions.js";
import { createApp } from "../app.js";
import type { PhotoStore } from "../photos/cloudinary.js";
import { destroyWait } from "../photos/destroy.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { MAX_CAPTION_LENGTH, MAX_PHOTOS_PER_IDEA } from "./photos.js";

const SECRET = "fake-api-secret-must-never-leak";

/** An in-memory PhotoStore: no network. `destroyed` lists the public ids it was asked to remove. */
function fakeStore() {
  const destroyed: string[] = [];
  const store: PhotoStore & { failDestroy: boolean; hang: boolean } = {
    cloudName: "demo",
    apiKey: "key123",
    failDestroy: false,
    hang: false,
    sign: (publicId, timestamp) => `sig(${publicId},${timestamp})`,
    thumbUrl: (publicId) => `https://img.test/thumb/${publicId}`,
    url: (publicId) => `https://img.test/full/${publicId}`,
    async destroy(publicId) {
      destroyed.push(publicId);
      if (store.hang) await new Promise<never>(() => {});
      if (store.failDestroy) throw new Error(`boom with ${SECRET}`);
    },
  };
  return { store, destroyed };
}

describe("/projects/:projectId/ideas/:ideaId/photos", () => {
  useTestApp();
  const clock = createClock();
  const { store, destroyed } = fakeStore();
  const app = createApp({ prisma, now: clock.now, photoStore: store });
  const appOff = createApp({ prisma, now: clock.now, photoStore: null });

  afterEach(() => {
    destroyed.length = 0;
    store.failDestroy = false;
    store.hang = false;
  });

  const destroyedCount = (n: number) => vi.waitFor(() => expect(destroyed.length).toBeGreaterThanOrEqual(n));
  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  type User = { id: string; token: string };

  /** owner, author (wrote the idea), other (member, not author), stranger (not a member). */
  async function world() {
    const owner = await createSignedInUser(clock);
    const author = await createSignedInUser(clock);
    const other = await createSignedInUser(clock);
    const stranger = await createSignedInUser(clock);
    const t0 = clock.now();
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0 },
    });
    const p = project.id;
    await addMember(p, owner.id, "owner");
    await addMember(p, author.id, "member");
    await addMember(p, other.id, "member");
    const i = (await prisma.idea.create({ data: { id: randomUUID(), projectId: p, authorId: author.id, title: "I" } })).id;
    clock.advanceMs(10_000);
    return { owner, author, other, stranger, p, i };
  }

  const base = (p: string, i: string) => `/projects/${p}/ideas/${i}/photos`;
  const publicIdOf = (p: string, i: string, id: string) => `earnm/${p}/ideas/${i}/${id}`;
  const sign = (u: User, p: string, i: string, body: Record<string, unknown> = { id: randomUUID() }, a = app) =>
    request(a).post(`${base(p, i)}/sign`).set(...bearer(u.token)).send(body);
  const record = (u: User, p: string, i: string, body: Record<string, unknown> = {}, a = app) => {
    const id = (body["id"] as string | undefined) ?? randomUUID();
    return request(a)
      .post(base(p, i))
      .set(...bearer(u.token))
      .send({ id, publicId: publicIdOf(p, i, id), width: 1200, height: 900, ...body });
  };
  const list = (u: User, p: string, i: string, a = app) => request(a).get(base(p, i)).set(...bearer(u.token));
  const patch = (u: User, p: string, i: string, photo: string, body: Record<string, unknown>) =>
    request(app).patch(`${base(p, i)}/${photo}`).set(...bearer(u.token)).send(body);
  const del = (u: User, p: string, i: string, photo: string) =>
    request(app).delete(`${base(p, i)}/${photo}`).set(...bearer(u.token));
  const captionBody = (value: string, offsetMs = 0) => ({ caption: { value, editedAt: iso(offsetMs) } });

  async function fill(w: { p: string; i: string; author: User }, count: number) {
    await prisma.ideaPhoto.createMany({
      data: Array.from({ length: count }, () => {
        const id = randomUUID();
        return { id, ideaId: w.i, addedById: w.author.id, publicId: publicIdOf(w.p, w.i, id), width: 10, height: 10 };
      }),
    });
  }

  it("answers 401 without a valid session", async () => {
    const w = await world();
    expectError(await request(app).get(base(w.p, w.i)), 401, "not_signed_in");
    expectError(await request(app).post(base(w.p, w.i)).send({}), 401, "not_signed_in");
    expectError(await request(app).post(`${base(w.p, w.i)}/sign`).send({}), 401, "not_signed_in");
    clock.advanceMs(SESSION_LIFETIME_MS + 1000);
    expectError(await list(w.author, w.p, w.i), 401, "not_signed_in");
  });

  it("answers 404 not_found to a non-member on every route", async () => {
    const w = await world();
    const photo = (await record(w.author, w.p, w.i)).body;
    expectError(await list(w.stranger, w.p, w.i), 404, "not_found");
    expectError(await sign(w.stranger, w.p, w.i), 404, "not_found");
    expectError(await record(w.stranger, w.p, w.i), 404, "not_found");
    expectError(await patch(w.stranger, w.p, w.i, photo.id, captionBody("x", -1000)), 404, "not_found");
    expectError(await del(w.stranger, w.p, w.i, photo.id), 404, "not_found");
    expectError(await list(w.author, w.p, randomUUID()), 404, "not_found");
  });

  it("answers 503 photos_unavailable when Cloudinary is not configured, after the sign-in check", async () => {
    const w = await world();
    expectError(await list(w.author, w.p, w.i, appOff), 503, "photos_unavailable");
    expectError(await sign(w.author, w.p, w.i, { id: randomUUID() }, appOff), 503, "photos_unavailable");
    expectError(await request(appOff).get(base(w.p, w.i)), 401, "not_signed_in");
  });

  describe("sign", () => {
    it("signs an upload for the author and the Owner, with an idea-scoped public id", async () => {
      const w = await world();
      for (const u of [w.author, w.owner]) {
        const id = randomUUID();
        const res = await sign(u, w.p, w.i, { id });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          cloudName: "demo",
          apiKey: "key123",
          publicId: publicIdOf(w.p, w.i, id),
          timestamp: Math.floor(clock.now().getTime() / 1000),
        });
        expect(res.body.signature).toBe(`sig(${publicIdOf(w.p, w.i, id)},${res.body.timestamp})`);
        expect(JSON.stringify(res.body)).not.toContain(SECRET);
      }
    });

    it("answers 403 to a member who is neither author nor Owner", async () => {
      const w = await world();
      expectError(await sign(w.other, w.p, w.i), 403, "forbidden");
    });

    it("refuses a bad body and a full idea, but still answers for a photo already recorded", async () => {
      const w = await world();
      expectError(await sign(w.author, w.p, w.i, {}), 400, "validation_failed");
      expectError(await sign(w.author, w.p, w.i, { id: "nope" }), 400, "validation_failed");
      await fill(w, MAX_PHOTOS_PER_IDEA);
      expectError(await sign(w.author, w.p, w.i), 409, "photo_limit_reached");
      const existing = await prisma.ideaPhoto.findFirstOrThrow();
      expect((await sign(w.author, w.p, w.i, { id: existing.id })).status).toBe(200);
    });
  });

  describe("record", () => {
    it("records a photo for the author, and answers with signed urls and no secret", async () => {
      const w = await world();
      const id = randomUUID();
      const res = await record(w.author, w.p, w.i, { id, caption: " Sketch " });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id,
        ideaId: w.i,
        addedBy: { id: w.author.id, displayName: "Bob" },
        caption: "Sketch",
        width: 1200,
        height: 900,
        createdAt: clock.now().toISOString(),
        thumbUrl: `https://img.test/thumb/${publicIdOf(w.p, w.i, id)}`,
        url: `https://img.test/full/${publicIdOf(w.p, w.i, id)}`,
      });
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it("lets the Owner record, and refuses another member (destroying nothing it did not sign)", async () => {
      const w = await world();
      expect((await record(w.owner, w.p, w.i)).status).toBe(201);
      const id = randomUUID();
      expectError(await record(w.other, w.p, w.i, { id }), 403, "forbidden");
      expect(await prisma.ideaPhoto.count()).toBe(1);
      // That member's upload can never be recorded, so the image is removed rather than orphaned.
      await destroyedCount(1);
      expect(destroyed).toEqual([publicIdOf(w.p, w.i, id)]);
    });

    it("never destroys an existing photo's image when a non-manager re-records its id (403)", async () => {
      const w = await world();
      const id = (await record(w.author, w.p, w.i)).body.id as string;
      expectError(await record(w.other, w.p, w.i, { id }), 403, "forbidden");
      // Give a wrongly started destroy time to show up.
      await new Promise((r) => setTimeout(r, 100));
      expect(destroyed).toEqual([]);
      expect(await prisma.ideaPhoto.count({ where: { id } })).toBe(1);
    });

    it("destroys the image when the id is already used on another idea (409)", async () => {
      const w = await world();
      const id = randomUUID();
      await record(w.author, w.p, w.i, { id });
      const j = (await prisma.idea.create({ data: { id: randomUUID(), projectId: w.p, authorId: w.author.id, title: "J" } })).id;
      expectError(await record(w.author, w.p, j, { id }), 409, "id_conflict");
      await destroyedCount(1);
      expect(destroyed).toEqual([publicIdOf(w.p, j, id)]);
    });

    it("refuses a public id that is not the one signed for this idea", async () => {
      const w = await world();
      const id = randomUUID();
      for (const publicId of [`earnm/${w.p}/${w.i}/${id}`, publicIdOf(w.p, randomUUID(), id), "x"]) {
        expectError(await record(w.author, w.p, w.i, { id, publicId }), 400, "validation_failed");
      }
      expectError(await record(w.author, w.p, w.i, { width: 0 }), 400, "validation_failed");
      expectError(await record(w.author, w.p, w.i, { caption: "c".repeat(MAX_CAPTION_LENGTH + 1) }), 400, "validation_failed");
      expectError(await record(w.author, w.p, w.i, { extra: 1 }), 400, "validation_failed");
      expect(await prisma.ideaPhoto.count()).toBe(0);
    });

    it("is idempotent for the same id, and 409 for an id used on another idea", async () => {
      const w = await world();
      const id = randomUUID();
      expect((await record(w.author, w.p, w.i, { id })).status).toBe(201);
      expect((await record(w.author, w.p, w.i, { id })).status).toBe(200);
      expect(await prisma.ideaPhoto.count()).toBe(1);
      const j = (await prisma.idea.create({ data: { id: randomUUID(), projectId: w.p, authorId: w.author.id, title: "J" } })).id;
      expectError(await record(w.author, w.p, j, { id }), 409, "id_conflict");
      expect(await prisma.ideaPhoto.count()).toBe(1);
    });

    it("refuses the 11th photo and destroys the uploaded image", async () => {
      const w = await world();
      await fill(w, MAX_PHOTOS_PER_IDEA);
      const id = randomUUID();
      expectError(await record(w.author, w.p, w.i, { id }), 409, "photo_limit_reached");
      await destroyedCount(1);
      expect(destroyed).toEqual([publicIdOf(w.p, w.i, id)]);
      expect(await prisma.ideaPhoto.count()).toBe(MAX_PHOTOS_PER_IDEA);
    });

    it("destroys the uploaded image when the idea was deleted after signing", async () => {
      const w = await world();
      const id = randomUUID();
      await prisma.idea.delete({ where: { id: w.i } });
      expectError(await record(w.author, w.p, w.i, { id }), 404, "not_found");
      await destroyedCount(1);
      expect(destroyed).toEqual([publicIdOf(w.p, w.i, id)]);
    });

    it("destroys nothing for a non-member even when the idea is gone", async () => {
      const w = await world();
      await prisma.idea.delete({ where: { id: w.i } });
      expectError(await record(w.stranger, w.p, w.i), 404, "not_found");
      await new Promise((r) => setTimeout(r, 20));
      expect(destroyed).toEqual([]);
    });

    it("destroys nothing for a stranger", async () => {
      const w = await world();
      await record(w.stranger, w.p, w.i);
      await new Promise((r) => setTimeout(r, 20));
      expect(destroyed).toEqual([]);
    });
  });

  describe("list", () => {
    it("shows every member the photos with signed urls, oldest first", async () => {
      const w = await world();
      const a = (await record(w.author, w.p, w.i)).body.id as string;
      clock.advanceMs(1000);
      const b = (await record(w.owner, w.p, w.i)).body.id as string;
      for (const u of [w.other, w.author, w.owner]) {
        const res = await list(u, w.p, w.i);
        expect(res.status).toBe(200);
        expect(res.body.photos.map((p: { id: string }) => p.id)).toEqual([a, b]);
        expect(res.body.photos[0].url).toBe(`https://img.test/full/${publicIdOf(w.p, w.i, a)}`);
      }
    });
  });

  describe("caption", () => {
    it("lets the author and the Owner edit it, and refuses another member", async () => {
      const w = await world();
      const id = (await record(w.author, w.p, w.i)).body.id as string;
      expect((await patch(w.author, w.p, w.i, id, captionBody("One", -2000))).body.caption).toBe("One");
      expect((await patch(w.owner, w.p, w.i, id, captionBody("Two", -1000))).body.caption).toBe("Two");
      expectError(await patch(w.other, w.p, w.i, id, captionBody("Three")), 403, "forbidden");
    });

    it("keeps the newer caption and refuses bad bodies", async () => {
      const w = await world();
      const id = (await record(w.author, w.p, w.i)).body.id as string;
      await patch(w.author, w.p, w.i, id, captionBody("Newer", -1000));
      expect((await patch(w.author, w.p, w.i, id, captionBody("Older", -5000))).body.caption).toBe("Newer");
      expectError(await patch(w.author, w.p, w.i, id, {}), 400, "validation_failed");
      expectError(await patch(w.author, w.p, w.i, id, captionBody("c".repeat(MAX_CAPTION_LENGTH + 1))), 400, "validation_failed");
    });
  });

  describe("delete", () => {
    it("lets the author and the Owner delete and destroys the image; refuses another member", async () => {
      const w = await world();
      const a = (await record(w.author, w.p, w.i)).body.id as string;
      const b = (await record(w.author, w.p, w.i)).body.id as string;
      expectError(await del(w.other, w.p, w.i, a), 403, "forbidden");
      expect(destroyed).toEqual([]);
      expect((await del(w.author, w.p, w.i, a)).status).toBe(204);
      expect((await del(w.owner, w.p, w.i, b)).status).toBe(204);
      await destroyedCount(2);
      expect(destroyed.sort()).toEqual([publicIdOf(w.p, w.i, a), publicIdOf(w.p, w.i, b)].sort());
      expectError(await del(w.author, w.p, w.i, a), 404, "not_found");
    });

    it("still answers 204 when the image store never answers", async () => {
      const w = await world();
      const a = (await record(w.author, w.p, w.i)).body.id as string;
      store.hang = true;
      const saved = destroyWait.ms;
      destroyWait.ms = 50;
      try {
        expect((await del(w.author, w.p, w.i, a)).status).toBe(204);
      } finally {
        destroyWait.ms = saved;
      }
      expect(await prisma.ideaPhoto.count()).toBe(0);
      expect(destroyed.length).toBe(1);
    });

    it("still answers 204 when the image store fails to destroy", async () => {
      const w = await world();
      const a = (await record(w.author, w.p, w.i)).body.id as string;
      store.failDestroy = true;
      expect((await del(w.author, w.p, w.i, a)).status).toBe(204);
      await destroyedCount(1);
      expect(await prisma.ideaPhoto.count()).toBe(0);
    });
  });
});
