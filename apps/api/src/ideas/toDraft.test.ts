import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type { PhotoStore } from "../photos/cloudinary.js";
import { MAX_DRAFTS_PER_PROJECT } from "../drafts/routes.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { copyWait } from "./toDraft.js";

/** A fake store that records every copy and destroy; `copyImpl` decides what a copy does. */
function makeStore(copyImpl?: (source: string, target: string) => Promise<{ width: number; height: number }>) {
  const copies: { source: string; target: string }[] = [];
  const destroyed: string[] = [];
  const store: PhotoStore = {
    cloudName: "demo",
    apiKey: "key123",
    sign: () => "sig",
    thumbUrl: (id) => `https://img.test/thumb/${id}`,
    url: (id) => `https://img.test/full/${id}`,
    async destroy(id) {
      destroyed.push(id);
    },
    async copy(source, target) {
      copies.push({ source, target });
      return copyImpl ? copyImpl(source, target) : { width: 640, height: 480 };
    },
  };
  return { store, copies, destroyed };
}

describe("POST /projects/:projectId/ideas/:ideaId/draft", () => {
  useTestApp();
  const clock = createClock();
  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  type User = { id: string; token: string };
  const defaultCopyMs = copyWait.ms;
  afterEach(() => {
    copyWait.ms = defaultCopyMs;
    vi.restoreAllMocks();
  });

  async function world(status: "new" | "considering" | "accepted" | "dropped" = "accepted", photos = 2) {
    const owner = await createSignedInUser(clock);
    const member = await createSignedInUser(clock);
    const stranger = await createSignedInUser(clock);
    const t0 = clock.now();
    const p = (
      await prisma.project.create({
        data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0 },
      })
    ).id;
    await addMember(p, owner.id, "owner");
    await addMember(p, member.id, "member");
    const i = (
      await prisma.idea.create({
        data: { id: randomUUID(), projectId: p, authorId: member.id, title: "Peach tea", description: "Summer", status },
      })
    ).id;
    const photoIds: string[] = [];
    for (let n = 0; n < photos; n++) {
      const id = randomUUID();
      photoIds.push(id);
      await prisma.ideaPhoto.create({
        data: {
          id,
          ideaId: i,
          addedById: member.id,
          publicId: `earnm/${p}/ideas/${i}/${id}`,
          width: 100 + n,
          height: 200 + n,
          caption: `cap ${n}`,
          createdAt: new Date(t0.getTime() + n * 1000),
        },
      });
    }
    return { owner, member, stranger, p, i, photoIds };
  }

  const body = (extra: Record<string, unknown> = {}) => ({
    draftId: randomUUID(),
    name: "Peach tea",
    sizes: ["M", "L"],
    ...extra,
  });
  const send = (app: ReturnType<typeof createApp>, u: User, p: string, i: string, b: unknown = body()) =>
    request(app).post(`/projects/${p}/ideas/${i}/draft`).set(...bearer(u.token)).send(b as object);
  const appWith = (store: PhotoStore | null) => createApp({ prisma, now: clock.now, photoStore: store });

  it("creates the draft linked to the idea and copies the photos to new images", async () => {
    const w = await world();
    const { store, copies, destroyed } = makeStore();
    const draftId = randomUUID();
    const res = await send(appWith(store), w.member, w.p, w.i, body({ draftId, expectedPrice: 45000, note: "n" }));
    expect(res.status).toBe(201);
    expect(res.body.photosNotCopied).toBe(0);
    expect(res.body.draft).toMatchObject({
      id: draftId,
      name: "Peach tea",
      sizes: ["M", "L"],
      expectedPrice: 45000,
      note: "n",
      ideaId: w.i,
      photoCount: 2,
    });
    expect(res.body.idea).toMatchObject({ id: w.i, status: "accepted", draftId });
    expect(res.body.idea.draft).toMatchObject({ id: draftId, name: "Peach tea" });

    const rows = await prisma.draftPhoto.findMany({ where: { draftId }, orderBy: { caption: "asc" } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.publicId.startsWith(`earnm/${w.p}/drafts/${draftId}/`)).toBe(true);
      expect(row.addedById).toBe(w.member.id);
    }
    // The caption is kept; the size is what the store answered for the copy.
    expect(rows.map((r) => [r.width, r.height, r.caption])).toEqual([
      [640, 480, "cap 0"],
      [640, 480, "cap 1"],
    ]);
    expect(copies.map((c) => c.source).sort()).toEqual(
      w.photoIds.map((id) => `earnm/${w.p}/ideas/${w.i}/${id}`).sort(),
    );
    // New public ids, none of them an idea photo's.
    expect(new Set(rows.map((r) => r.publicId))).toEqual(new Set(copies.map((c) => c.target)));
    expect(destroyed).toEqual([]);
    const ideaPhotos = await prisma.ideaPhoto.findMany({ where: { ideaId: w.i } });
    expect(ideaPhotos.map((r) => r.id).sort()).toEqual([...w.photoIds].sort());
  });

  it("works for an idea without photos and for a server without a store", async () => {
    const w0 = await world("accepted", 0);
    const { store, copies } = makeStore();
    const r0 = await send(appWith(store), w0.member, w0.p, w0.i);
    expect(r0.status).toBe(201);
    expect(r0.body.photosNotCopied).toBe(0);
    expect(copies).toEqual([]);

    const w = await world("accepted", 2);
    const r = await send(appWith(null), w.member, w.p, w.i);
    expect(r.status).toBe(201);
    expect(r.body.photosNotCopied).toBe(2);
    expect(await prisma.draftPhoto.count({ where: { draftId: r.body.draft.id } })).toBe(0);
  });

  it("counts a failing copy and keeps the others", async () => {
    const w = await world();
    const failing = `earnm/${w.p}/ideas/${w.i}/${w.photoIds[0]}`;
    const { store, destroyed } = makeStore(async (source) => {
      if (source === failing) throw new Error("boom");
      return { width: 5, height: 6 };
    });
    const res = await send(appWith(store), w.member, w.p, w.i);
    expect(res.status).toBe(201);
    expect(res.body.photosNotCopied).toBe(1);
    expect(res.body.draft.photoCount).toBe(1);
    const rows = await prisma.draftPhoto.findMany({ where: { draftId: res.body.draft.id } });
    expect(rows.map((r) => r.caption)).toEqual(["cap 1"]);
    expect(destroyed).toEqual([]);
  });

  it("counts a copy that hangs past the timeout, and removes its image if it lands later", async () => {
    copyWait.ms = 40;
    const w = await world();
    const hanging = `earnm/${w.p}/ideas/${w.i}/${w.photoIds[1]}`;
    let finishLate: () => void = () => {};
    const { store, copies, destroyed } = makeStore((source) => {
      if (source !== hanging) return Promise.resolve({ width: 5, height: 6 });
      return new Promise((resolve) => {
        finishLate = () => resolve({ width: 9, height: 9 });
      });
    });
    const res = await send(appWith(store), w.member, w.p, w.i);
    expect(res.status).toBe(201);
    expect(res.body.photosNotCopied).toBe(1);
    expect(await prisma.draftPhoto.count({ where: { draftId: res.body.draft.id } })).toBe(1);
    const hungTarget = copies.find((c) => c.source === hanging)!.target;
    expect(destroyed).not.toContain(hungTarget);
    finishLate();
    await vi.waitFor(() => expect(destroyed).toEqual([hungTarget]));
  });

  it("copies at most three photos at a time", async () => {
    const w = await world("accepted", 7);
    let running = 0;
    let peak = 0;
    const { store } = makeStore(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 15));
      running--;
      return { width: 1, height: 1 };
    });
    const res = await send(appWith(store), w.member, w.p, w.i);
    expect(res.status).toBe(201);
    expect(res.body.photosNotCopied).toBe(0);
    expect(res.body.draft.photoCount).toBe(7);
    expect(peak).toBe(3);
  });

  it("destroys the copies it made, and only those, when recording them fails", async () => {
    const w = await world();
    // An image another row already owns: it must survive.
    const owned = `earnm/${w.p}/ideas/${w.i}/${w.photoIds[0]}`;
    const { store, copies, destroyed } = makeStore();
    let transactions = 0;
    const realTransaction = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
    vi.spyOn(prisma, "$transaction").mockImplementation(((...args: unknown[]) => {
      transactions++;
      // 1: the create under the lock; 2: recording the photos.
      if (transactions === 2) return Promise.reject(new Error("record step failed"));
      return realTransaction(...args);
    }) as never);
    const res = await send(appWith(store), w.member, w.p, w.i);
    vi.restoreAllMocks();
    expect(res.status).toBe(201);
    expect(res.body.photosNotCopied).toBe(2);
    expect(res.body.draft.photoCount).toBe(0);
    expect(res.body.draft.ideaId).toBe(w.i);
    expect(copies).toHaveLength(2);
    expect([...destroyed].sort()).toEqual(copies.map((c) => c.target).sort());
    expect(destroyed).not.toContain(owned);
    expect(await prisma.draftPhoto.count()).toBe(0);
    expect(await prisma.ideaPhoto.count({ where: { ideaId: w.i } })).toBe(2);
  });

  it("destroys the copies and answers 404 when the draft is deleted while they are copied", async () => {
    const w = await world();
    const draftId = randomUUID();
    const { store, copies, destroyed } = makeStore(async () => {
      await prisma.draft.deleteMany({ where: { id: draftId } });
      return { width: 3, height: 3 };
    });
    const res = await send(appWith(store), w.member, w.p, w.i, body({ draftId }));
    expectError(res, 404, "not_found");
    expect([...destroyed].sort()).toEqual(copies.map((c) => c.target).sort());
    expect(await prisma.draftPhoto.count()).toBe(0);
  });

  it("refuses an idea that is not accepted, creating nothing and copying nothing", async () => {
    for (const status of ["new", "considering", "dropped"] as const) {
      const w = await world(status);
      const { store, copies } = makeStore();
      expectError(await send(appWith(store), w.member, w.p, w.i), 409, "idea_not_accepted");
      expect(await prisma.draft.count({ where: { projectId: w.p } })).toBe(0);
      expect(copies).toEqual([]);
    }
  });

  it("makes one draft per idea, and keeps the link when the idea's status changes", async () => {
    const w = await world();
    const app = appWith(makeStore().store);
    const first = await send(app, w.member, w.p, w.i);
    expect(first.status).toBe(201);
    expectError(await send(app, w.owner, w.p, w.i), 409, "idea_already_has_draft");
    await prisma.idea.update({ where: { id: w.i }, data: { status: "dropped" } });
    const draft = await prisma.draft.findUniqueOrThrow({ where: { id: first.body.draft.id } });
    expect(draft.ideaId).toBe(w.i);
    expect(await prisma.draft.count({ where: { projectId: w.p } })).toBe(1);
  });

  it("allows only one of two simultaneous requests", async () => {
    const w = await world();
    const app = appWith(makeStore().store);
    const [a, b] = await Promise.all([send(app, w.member, w.p, w.i), send(app, w.owner, w.p, w.i)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expectError(a.status === 409 ? a : b, 409, "idea_already_has_draft");
    expect(await prisma.draft.count({ where: { projectId: w.p } })).toBe(1);
    expect(await prisma.draftPhoto.count()).toBe(2);
  });

  it("refuses a draft id that is taken, in any project", async () => {
    const w = await world();
    const other = await world();
    const taken = randomUUID();
    const t0 = clock.now();
    await prisma.draft.create({
      data: {
        id: taken, projectId: other.p, name: "X", sizes: ["M"], nameEditedAt: t0, sizesEditedAt: t0,
        expectedPriceEditedAt: t0, noteEditedAt: t0, statusEditedAt: t0,
      },
    });
    const { store, copies } = makeStore();
    expectError(await send(appWith(store), w.member, w.p, w.i, body({ draftId: taken })), 409, "id_conflict");
    expect(copies).toEqual([]);
    expect((await prisma.draft.findUniqueOrThrow({ where: { id: taken } })).ideaId).toBeNull();
  });

  it("respects the draft limit, which counts only unconverted drafts", async () => {
    const w = await world();
    const t0 = clock.now();
    const rows = (converted: boolean, n: number) =>
      Array.from({ length: n }, () => ({
        id: randomUUID(), projectId: w.p, name: "X", sizes: ["M" as const], nameEditedAt: t0, sizesEditedAt: t0,
        expectedPriceEditedAt: t0, noteEditedAt: t0, statusEditedAt: t0, convertedAt: converted ? t0 : null,
      }));
    await prisma.draft.createMany({ data: [...rows(false, MAX_DRAFTS_PER_PROJECT), ...rows(true, 3)] });
    const { store, copies } = makeStore();
    expectError(await send(appWith(store), w.member, w.p, w.i), 409, "draft_limit_reached");
    expect(copies).toEqual([]);
    // One below the limit: the converted drafts did not count.
    const one = await prisma.draft.findFirstOrThrow({ where: { projectId: w.p, convertedAt: null } });
    await prisma.draft.delete({ where: { id: one.id } });
    expect((await send(appWith(store), w.member, w.p, w.i)).status).toBe(201);
  });

  it("validates the body like a draft create", async () => {
    const w = await world();
    const app = appWith(makeStore().store);
    const bad: unknown[] = [
      {},
      body({ draftId: "nope" }),
      body({ name: "" }),
      body({ sizes: [] }),
      body({ sizes: ["M", "M"] }),
      body({ expectedPrice: -1 }),
      body({ expectedPrice: 1.5 }),
      body({ extra: 1 }),
      body({ note: "x".repeat(2001) }),
    ];
    for (const b of bad) expectError(await send(app, w.member, w.p, w.i, b), 400, "validation_failed");
    expect(await prisma.draft.count({ where: { projectId: w.p } })).toBe(0);
  });

  it("refuses a price above the project's currency cap", async () => {
    const w = await world();
    await prisma.project.update({ where: { id: w.p }, data: { currency: "USD" } });
    const app = appWith(makeStore().store);
    // Within the VND cap the body schema allows, above the USD one.
    expectError(await send(app, w.member, w.p, w.i, body({ expectedPrice: 99_999_999_999 })), 400, "validation_failed");
    expect(await prisma.draft.count({ where: { projectId: w.p } })).toBe(0);
  });

  it("answers 404 to a stranger, an idea in another project and an unknown idea", async () => {
    const w = await world();
    const other = await world();
    const app = appWith(makeStore().store);
    expectError(await send(app, w.stranger, w.p, w.i), 404, "not_found");
    expectError(await send(app, w.member, other.p, other.i), 404, "not_found");
    expectError(await send(app, w.member, w.p, other.i), 404, "not_found");
    expectError(await send(app, w.member, w.p, randomUUID()), 404, "not_found");
    expect(await prisma.draft.count()).toBe(0);
  });

  it("needs a signed-in user", async () => {
    const w = await world();
    const res = await request(appWith(null)).post(`/projects/${w.p}/ideas/${w.i}/draft`).send(body());
    expect(res.status).toBe(401);
  });

  it("frees the idea when its draft is deleted, and leaves the draft unlinked when the idea is deleted", async () => {
    const w = await world();
    const app = appWith(makeStore().store);
    const first = await send(app, w.member, w.p, w.i);
    await prisma.draft.delete({ where: { id: first.body.draft.id } });
    const again = await send(app, w.member, w.p, w.i);
    expect(again.status).toBe(201);
    await prisma.idea.delete({ where: { id: w.i } });
    expect((await prisma.draft.findUniqueOrThrow({ where: { id: again.body.draft.id } })).ideaId).toBeNull();
  });

  it("keeps a copied image when its own id is recorded against a full draft", async () => {
    const w = await world("accepted", 10);
    const { store, destroyed } = makeStore();
    const app = appWith(store);
    const res = await send(app, w.member, w.p, w.i);
    expect(res.status).toBe(201);
    expect(res.body.draft.photoCount).toBe(10);
    const rows = await prisma.draftPhoto.findMany({ where: { draftId: res.body.draft.id } });
    expect(rows).toHaveLength(10);
    // The row id is the id inside the copied image's public id, so a member can compute it.
    for (const row of rows) expect(row.publicId).toBe(`earnm/${w.p}/drafts/${res.body.draft.id}/${row.id}`);
    const again = await request(app)
      .post(`/projects/${w.p}/drafts/${res.body.draft.id}/photos`)
      .set(...bearer(w.owner.token))
      .send({ id: rows[0]!.id, publicId: rows[0]!.publicId, width: 1, height: 1 });
    // The row already has this id, so the record is a retry of a recorded photo.
    expect(again.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(destroyed).toEqual([]);
    expect(await prisma.draftPhoto.count({ where: { draftId: res.body.draft.id } })).toBe(10);
  });

  it("does not destroy an image a row owns when the full-draft branch is reached for its public id", async () => {
    const w = await world("accepted", 10);
    const { store, destroyed } = makeStore();
    const app = appWith(store);
    const res = await send(app, w.member, w.p, w.i);
    const draftId = res.body.draft.id as string;
    // A row that owns a public id under a different row id (e.g. rows made before ids were shared).
    const row = (await prisma.draftPhoto.findFirst({ where: { draftId } }))!;
    const other = randomUUID();
    const owned = `earnm/${w.p}/drafts/${draftId}/${other}`;
    await prisma.draftPhoto.update({ where: { id: row.id }, data: { publicId: owned } });
    const clash = await request(app)
      .post(`/projects/${w.p}/drafts/${draftId}/photos`)
      .set(...bearer(w.owner.token))
      .send({ id: other, publicId: owned, width: 1, height: 1 });
    expectError(clash, 409, "photo_limit_reached");
    await new Promise((r) => setTimeout(r, 50));
    expect(destroyed).toEqual([]);
    expect(await prisma.draftPhoto.count({ where: { publicId: owned } })).toBe(1);
  });

  /** A store whose copies wait for `release()`, so a test can act inside the copy window. */
  function pausedStore() {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const made = makeStore(async () => {
      await gate;
      return { width: 3, height: 3 };
    });
    return { ...made, release };
  }

  it("records nothing and destroys the copies when the draft is converted during the copy window", async () => {
    const w = await world();
    const draftId = randomUUID();
    const { store, copies, destroyed, release } = pausedStore();
    const pending = send(appWith(store), w.member, w.p, w.i, body({ draftId })).then((r) => r);
    await vi.waitFor(() => expect(copies.length).toBeGreaterThan(0));
    await prisma.draft.update({ where: { id: draftId }, data: { convertedAt: clock.now() } });
    release();
    const res = await pending;
    expect(res.status).toBe(201);
    expect(res.body.photosNotCopied).toBe(2);
    expect(await prisma.draftPhoto.count({ where: { draftId } })).toBe(0);
    expect([...destroyed].sort()).toEqual(copies.map((c) => c.target).sort());
  });

  it("records only what fits under the cap when photos were added during the copy window", async () => {
    const w = await world("accepted", 3);
    const draftId = randomUUID();
    const { store, copies, destroyed, release } = pausedStore();
    const pending = send(appWith(store), w.member, w.p, w.i, body({ draftId })).then((r) => r);
    await vi.waitFor(() => expect(copies.length).toBeGreaterThan(0));
    for (let n = 0; n < 8; n++) {
      const id = randomUUID();
      await prisma.draftPhoto.create({
        data: {
          id,
          draftId,
          addedById: w.owner.id,
          publicId: `earnm/${w.p}/drafts/${draftId}/${id}`,
          width: 1,
          height: 1,
          caption: "",
          captionEditedAt: new Date(0),
          createdAt: clock.now(),
        },
      });
    }
    release();
    const res = await pending;
    expect(res.status).toBe(201);
    expect(res.body.photosNotCopied).toBe(1);
    expect(await prisma.draftPhoto.count({ where: { draftId } })).toBe(10);
    expect(destroyed).toHaveLength(1);
    const kept = await prisma.draftPhoto.findMany({ where: { publicId: { in: copies.map((c) => c.target) } } });
    expect(kept).toHaveLength(2);
    expect(copies.map((c) => c.target)).toContain(destroyed[0]);
    expect(kept.map((k) => k.publicId)).not.toContain(destroyed[0]);
  });

  it("destroys the copies and keeps the draft when the caller is removed during the copy window", async () => {
    const w = await world();
    const draftId = randomUUID();
    const { store, copies, destroyed, release } = pausedStore();
    const pending = send(appWith(store), w.member, w.p, w.i, body({ draftId })).then((r) => r);
    await vi.waitFor(() => expect(copies.length).toBeGreaterThan(0));
    await prisma.projectMember.delete({ where: { projectId_userId: { projectId: w.p, userId: w.member.id } } });
    release();
    const res = await pending;
    // Answered like any failing step 3: the draft stays, none of the copies are recorded or kept.
    expect(res.status).toBe(201);
    expect(res.body.photosNotCopied).toBe(2);
    expect(await prisma.draft.count({ where: { id: draftId } })).toBe(1);
    expect(await prisma.draftPhoto.count({ where: { draftId } })).toBe(0);
    expect([...destroyed].sort()).toEqual(copies.map((c) => c.target).sort());
  });
});
