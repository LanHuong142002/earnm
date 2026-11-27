import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_LIFETIME_MS } from "../auth/sessions.js";
import { createApp } from "../app.js";
import type { PhotoStore } from "../photos/cloudinary.js";
import { destroyWait } from "../photos/destroy.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { draftPhotoPublicId, MAX_CAPTION_LENGTH, MAX_PHOTOS_PER_DRAFT } from "./photos.js";

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
    copy: async () => ({ width: 1200, height: 900 }),
    async destroy(publicId) {
      destroyed.push(publicId);
      if (store.hang) await new Promise<never>(() => {});
      if (store.failDestroy) throw new Error(`boom with ${SECRET}`);
    },
  };
  return { store, destroyed };
}

describe("/projects/:projectId/drafts/:draftId/photos", () => {
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

  /** owner, adder and other (members), stranger (not a member). */
  async function world() {
    const owner = await createSignedInUser(clock);
    const adder = await createSignedInUser(clock);
    const other = await createSignedInUser(clock);
    const stranger = await createSignedInUser(clock);
    const t0 = clock.now();
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0 },
    });
    const p = project.id;
    await addMember(p, owner.id, "owner");
    await addMember(p, adder.id, "member");
    await addMember(p, other.id, "member");
    const d = (await prisma.draft.create({ data: { id: randomUUID(), projectId: p, name: "D", sizes: ["M"] } })).id;
    clock.advanceMs(10_000);
    return { owner, adder, other, stranger, p, d };
  }

  const base = (p: string, d: string) => `/projects/${p}/drafts/${d}/photos`;
  const publicIdOf = draftPhotoPublicId;
  const sign = (u: User, p: string, d: string, body: Record<string, unknown> = { id: randomUUID() }, a = app) =>
    request(a).post(`${base(p, d)}/sign`).set(...bearer(u.token)).send(body);
  const record = (u: User, p: string, d: string, body: Record<string, unknown> = {}, a = app) => {
    const id = (body["id"] as string | undefined) ?? randomUUID();
    return request(a)
      .post(base(p, d))
      .set(...bearer(u.token))
      .send({ id, publicId: publicIdOf(p, d, id), width: 1200, height: 900, ...body });
  };
  const list = (u: User, p: string, d: string, a = app) => request(a).get(base(p, d)).set(...bearer(u.token));
  const patch = (u: User, p: string, d: string, photo: string, body: Record<string, unknown>) =>
    request(app).patch(`${base(p, d)}/${photo}`).set(...bearer(u.token)).send(body);
  const del = (u: User, p: string, d: string, photo: string) =>
    request(app).delete(`${base(p, d)}/${photo}`).set(...bearer(u.token));
  const captionBody = (value: string, offsetMs = 0) => ({ caption: { value, editedAt: iso(offsetMs) } });
  const convert = (d: string) => prisma.draft.update({ where: { id: d }, data: { convertedAt: clock.now() } });

  async function fill(w: { p: string; d: string; adder: User }, count: number) {
    await prisma.draftPhoto.createMany({
      data: Array.from({ length: count }, () => {
        const id = randomUUID();
        return { id, draftId: w.d, addedById: w.adder.id, publicId: publicIdOf(w.p, w.d, id), width: 10, height: 10 };
      }),
    });
  }

  it("builds the public id from the project, the draft and the photo", () => {
    expect(draftPhotoPublicId("p", "d", "f")).toBe("earnm/p/drafts/d/f");
  });

  it("answers 401 without a valid session", async () => {
    const w = await world();
    expectError(await request(app).get(base(w.p, w.d)), 401, "not_signed_in");
    expectError(await request(app).post(base(w.p, w.d)).send({}), 401, "not_signed_in");
    expectError(await request(app).post(`${base(w.p, w.d)}/sign`).send({}), 401, "not_signed_in");
    clock.advanceMs(SESSION_LIFETIME_MS + 1000);
    expectError(await list(w.adder, w.p, w.d), 401, "not_signed_in");
  });

  it("answers 404 not_found to a non-member on every route", async () => {
    const w = await world();
    const photo = (await record(w.adder, w.p, w.d)).body;
    expectError(await list(w.stranger, w.p, w.d), 404, "not_found");
    expectError(await sign(w.stranger, w.p, w.d), 404, "not_found");
    expectError(await record(w.stranger, w.p, w.d), 404, "not_found");
    expectError(await patch(w.stranger, w.p, w.d, photo.id, captionBody("x", -1000)), 404, "not_found");
    expectError(await del(w.stranger, w.p, w.d, photo.id), 404, "not_found");
    expectError(await list(w.adder, w.p, randomUUID()), 404, "not_found");
  });

  it("answers 503 photos_unavailable when Cloudinary is not configured, after the sign-in check", async () => {
    const w = await world();
    expectError(await list(w.adder, w.p, w.d, appOff), 503, "photos_unavailable");
    expectError(await sign(w.adder, w.p, w.d, { id: randomUUID() }, appOff), 503, "photos_unavailable");
    expectError(await request(appOff).get(base(w.p, w.d)), 401, "not_signed_in");
  });

  describe("sign", () => {
    it("signs an upload for any member, with a draft-scoped public id", async () => {
      const w = await world();
      for (const u of [w.adder, w.owner, w.other]) {
        const id = randomUUID();
        const res = await sign(u, w.p, w.d, { id });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          cloudName: "demo",
          apiKey: "key123",
          publicId: publicIdOf(w.p, w.d, id),
          timestamp: Math.floor(clock.now().getTime() / 1000),
        });
        expect(res.body.signature).toBe(`sig(${publicIdOf(w.p, w.d, id)},${res.body.timestamp})`);
        expect(JSON.stringify(res.body)).not.toContain(SECRET);
      }
    });

    it("refuses a bad body and a full draft, but still answers for a photo already recorded", async () => {
      const w = await world();
      expectError(await sign(w.adder, w.p, w.d, {}), 400, "validation_failed");
      expectError(await sign(w.adder, w.p, w.d, { id: "nope" }), 400, "validation_failed");
      await fill(w, MAX_PHOTOS_PER_DRAFT);
      expectError(await sign(w.adder, w.p, w.d), 409, "photo_limit_reached");
      const existing = await prisma.draftPhoto.findFirstOrThrow();
      expect((await sign(w.adder, w.p, w.d, { id: existing.id })).status).toBe(200);
    });

    it("answers 409 draft_converted on a converted draft", async () => {
      const w = await world();
      await convert(w.d);
      expectError(await sign(w.adder, w.p, w.d), 409, "draft_converted");
    });
  });

  describe("record", () => {
    it("records a photo for any member, and answers with signed urls and no secret", async () => {
      const w = await world();
      const id = randomUUID();
      const res = await record(w.other, w.p, w.d, { id, caption: " Sketch " });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id,
        draftId: w.d,
        addedBy: { id: w.other.id, displayName: "Bob" },
        caption: "Sketch",
        width: 1200,
        height: 900,
        createdAt: clock.now().toISOString(),
        thumbUrl: `https://img.test/thumb/${publicIdOf(w.p, w.d, id)}`,
        url: `https://img.test/full/${publicIdOf(w.p, w.d, id)}`,
      });
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
      expect((await record(w.owner, w.p, w.d)).status).toBe(201);
    });

    it("destroys the image when the id is already used on another draft (409)", async () => {
      const w = await world();
      const id = randomUUID();
      await record(w.adder, w.p, w.d, { id });
      const e = (await prisma.draft.create({ data: { id: randomUUID(), projectId: w.p, name: "E", sizes: ["M"] } })).id;
      expectError(await record(w.adder, w.p, e, { id }), 409, "id_conflict");
      await destroyedCount(1);
      expect(destroyed).toEqual([publicIdOf(w.p, e, id)]);
    });

    it("refuses a public id that is not the one signed for this draft", async () => {
      const w = await world();
      const id = randomUUID();
      for (const publicId of [`earnm/${w.p}/${w.d}/${id}`, publicIdOf(w.p, randomUUID(), id), `earnm/${w.p}/ideas/${w.d}/${id}`, "x"]) {
        expectError(await record(w.adder, w.p, w.d, { id, publicId }), 400, "validation_failed");
      }
      expectError(await record(w.adder, w.p, w.d, { width: 0 }), 400, "validation_failed");
      expectError(await record(w.adder, w.p, w.d, { caption: "c".repeat(MAX_CAPTION_LENGTH + 1) }), 400, "validation_failed");
      expectError(await record(w.adder, w.p, w.d, { extra: 1 }), 400, "validation_failed");
      expect(await prisma.draftPhoto.count()).toBe(0);
    });

    it("is idempotent for the same id, and 409 for an id used on another draft", async () => {
      const w = await world();
      const id = randomUUID();
      expect((await record(w.adder, w.p, w.d, { id })).status).toBe(201);
      expect((await record(w.adder, w.p, w.d, { id })).status).toBe(200);
      expect(await prisma.draftPhoto.count()).toBe(1);
      const e = (await prisma.draft.create({ data: { id: randomUUID(), projectId: w.p, name: "E", sizes: ["M"] } })).id;
      expectError(await record(w.adder, w.p, e, { id }), 409, "id_conflict");
      expect(await prisma.draftPhoto.count()).toBe(1);
    });

    it("refuses the 11th photo and destroys the uploaded image", async () => {
      const w = await world();
      await fill(w, MAX_PHOTOS_PER_DRAFT);
      const id = randomUUID();
      expectError(await record(w.adder, w.p, w.d, { id }), 409, "photo_limit_reached");
      await destroyedCount(1);
      expect(destroyed).toEqual([publicIdOf(w.p, w.d, id)]);
      expect(await prisma.draftPhoto.count()).toBe(MAX_PHOTOS_PER_DRAFT);
    });

    it("answers 409 draft_converted and destroys the unrecorded image on a converted draft", async () => {
      const w = await world();
      await convert(w.d);
      const id = randomUUID();
      expectError(await record(w.adder, w.p, w.d, { id }), 409, "draft_converted");
      await destroyedCount(1);
      expect(destroyed).toEqual([publicIdOf(w.p, w.d, id)]);
      expect(await prisma.draftPhoto.count()).toBe(0);
    });

    it("never destroys a recorded photo's image when its id is re-recorded on a converted draft", async () => {
      const w = await world();
      const id = (await record(w.adder, w.p, w.d)).body.id as string;
      await convert(w.d);
      expectError(await record(w.other, w.p, w.d, { id }), 409, "draft_converted");
      await new Promise((r) => setTimeout(r, 100));
      expect(destroyed).toEqual([]);
      expect(await prisma.draftPhoto.count({ where: { id } })).toBe(1);
    });

    it("destroys the uploaded image when the draft was deleted after signing", async () => {
      const w = await world();
      const id = randomUUID();
      await prisma.draft.delete({ where: { id: w.d } });
      expectError(await record(w.adder, w.p, w.d, { id }), 404, "not_found");
      await destroyedCount(1);
      expect(destroyed).toEqual([publicIdOf(w.p, w.d, id)]);
    });

    it("destroys nothing for a non-member even when the draft is gone", async () => {
      const w = await world();
      await prisma.draft.delete({ where: { id: w.d } });
      expectError(await record(w.stranger, w.p, w.d), 404, "not_found");
      await new Promise((r) => setTimeout(r, 20));
      expect(destroyed).toEqual([]);
    });

    it("destroys nothing for a stranger", async () => {
      const w = await world();
      await record(w.stranger, w.p, w.d);
      await new Promise((r) => setTimeout(r, 20));
      expect(destroyed).toEqual([]);
    });
  });

  describe("list", () => {
    it("shows every member the photos with signed urls, oldest first, and still works once converted", async () => {
      const w = await world();
      const a = (await record(w.adder, w.p, w.d)).body.id as string;
      clock.advanceMs(1000);
      const b = (await record(w.owner, w.p, w.d)).body.id as string;
      await convert(w.d);
      for (const u of [w.other, w.adder, w.owner]) {
        const res = await list(u, w.p, w.d);
        expect(res.status).toBe(200);
        expect(res.body.photos.map((p: { id: string }) => p.id)).toEqual([a, b]);
        expect(res.body.photos[0].url).toBe(`https://img.test/full/${publicIdOf(w.p, w.d, a)}`);
      }
    });
  });

  describe("caption", () => {
    it("lets the adder and the Owner edit it, and refuses another member", async () => {
      const w = await world();
      const id = (await record(w.adder, w.p, w.d)).body.id as string;
      expect((await patch(w.adder, w.p, w.d, id, captionBody("One", -2000))).body.caption).toBe("One");
      expect((await patch(w.owner, w.p, w.d, id, captionBody("Two", -1000))).body.caption).toBe("Two");
      expectError(await patch(w.other, w.p, w.d, id, captionBody("Three")), 403, "forbidden");
    });

    it("lets a member edit the caption of their own photo but not another member's", async () => {
      const w = await world();
      const id = (await record(w.other, w.p, w.d)).body.id as string;
      expect((await patch(w.other, w.p, w.d, id, captionBody("Mine"))).body.caption).toBe("Mine");
      expectError(await patch(w.adder, w.p, w.d, id, captionBody("Not mine", 1000)), 403, "forbidden");
    });

    it("keeps the newer caption and refuses bad bodies", async () => {
      const w = await world();
      const id = (await record(w.adder, w.p, w.d)).body.id as string;
      await patch(w.adder, w.p, w.d, id, captionBody("Newer", -1000));
      expect((await patch(w.adder, w.p, w.d, id, captionBody("Older", -5000))).body.caption).toBe("Newer");
      expectError(await patch(w.adder, w.p, w.d, id, {}), 400, "validation_failed");
      expectError(await patch(w.adder, w.p, w.d, id, captionBody("c".repeat(MAX_CAPTION_LENGTH + 1))), 400, "validation_failed");
    });

    it("answers 409 draft_converted on a converted draft, even to an Owner", async () => {
      const w = await world();
      const id = (await record(w.adder, w.p, w.d)).body.id as string;
      await convert(w.d);
      expectError(await patch(w.owner, w.p, w.d, id, captionBody("x", 1000)), 409, "draft_converted");
      expect((await prisma.draftPhoto.findUniqueOrThrow({ where: { id } })).caption).toBe("");
    });
  });

  describe("delete", () => {
    it("lets the adder and the Owner delete and destroys the image; refuses another member", async () => {
      const w = await world();
      const a = (await record(w.adder, w.p, w.d)).body.id as string;
      const b = (await record(w.adder, w.p, w.d)).body.id as string;
      expectError(await del(w.other, w.p, w.d, a), 403, "forbidden");
      expect(destroyed).toEqual([]);
      expect((await del(w.adder, w.p, w.d, a)).status).toBe(204);
      expect((await del(w.owner, w.p, w.d, b)).status).toBe(204);
      await destroyedCount(2);
      expect(destroyed.sort()).toEqual([publicIdOf(w.p, w.d, a), publicIdOf(w.p, w.d, b)].sort());
      expectError(await del(w.adder, w.p, w.d, a), 404, "not_found");
    });

    it("answers 409 draft_converted on a converted draft and keeps the photo and its image", async () => {
      const w = await world();
      const a = (await record(w.adder, w.p, w.d)).body.id as string;
      await convert(w.d);
      expectError(await del(w.adder, w.p, w.d, a), 409, "draft_converted");
      expectError(await del(w.owner, w.p, w.d, a), 409, "draft_converted");
      expect(await prisma.draftPhoto.count()).toBe(1);
      expect(destroyed).toEqual([]);
    });

    it("still answers 204 when the image store never answers", async () => {
      const w = await world();
      const a = (await record(w.adder, w.p, w.d)).body.id as string;
      store.hang = true;
      const saved = destroyWait.ms;
      destroyWait.ms = 50;
      try {
        expect((await del(w.adder, w.p, w.d, a)).status).toBe(204);
      } finally {
        destroyWait.ms = saved;
      }
      expect(await prisma.draftPhoto.count()).toBe(0);
      expect(destroyed.length).toBe(1);
    });

    it("still answers 204 when the image store fails to destroy", async () => {
      const w = await world();
      const a = (await record(w.adder, w.p, w.d)).body.id as string;
      store.failDestroy = true;
      expect((await del(w.adder, w.p, w.d, a)).status).toBe(204);
      await destroyedCount(1);
      expect(await prisma.draftPhoto.count()).toBe(0);
    });
  });
});
