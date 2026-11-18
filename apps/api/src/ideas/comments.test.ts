import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { SESSION_LIFETIME_MS } from "../auth/sessions.js";
import { createApp } from "../app.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { MAX_COMMENTS_PER_IDEA } from "./comments.js";

describe("/projects/:projectId/ideas/:ideaId/comments", () => {
  useTestApp();
  const clock = createClock();
  const app = createApp({ prisma, now: clock.now });

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  type User = { id: string; token: string };

  /** owner, author (wrote the idea), other (members), stranger (not a member). */
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
    const idea = await prisma.idea.create({ data: { id: randomUUID(), projectId: p, authorId: author.id, title: "I" } });
    clock.advanceMs(10_000);
    return { owner, author, other, stranger, p, i: idea.id };
  }

  const base = (p: string, i: string) => `/projects/${p}/ideas/${i}/comments`;
  const post = (u: User, p: string, i: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post(base(p, i))
      .set(...bearer(u.token))
      .send({ id: randomUUID(), text: "Nice", ...body });
  const list = (u: User, p: string, i: string) => request(app).get(base(p, i)).set(...bearer(u.token));
  const patch = (u: User, p: string, i: string, c: string, body: Record<string, unknown>) =>
    request(app).patch(`${base(p, i)}/${c}`).set(...bearer(u.token)).send(body);
  const del = (u: User, p: string, i: string, c: string) =>
    request(app).delete(`${base(p, i)}/${c}`).set(...bearer(u.token));
  const textBody = (value: string, offsetMs = 0) => ({ text: { value, editedAt: iso(offsetMs) } });

  it("answers 401 without a valid session", async () => {
    const w = await world();
    expectError(await request(app).get(base(w.p, w.i)), 401, "not_signed_in");
    expectError(await request(app).post(base(w.p, w.i)).send({}), 401, "not_signed_in");
    clock.advanceMs(SESSION_LIFETIME_MS + 1000);
    expectError(await list(w.author, w.p, w.i), 401, "not_signed_in");
  });

  it("answers 404 not_found to a non-member on every route, and for another idea", async () => {
    const w = await world();
    const c = (await post(w.author, w.p, w.i)).body.id as string;
    expectError(await list(w.stranger, w.p, w.i), 404, "not_found");
    expectError(await post(w.stranger, w.p, w.i), 404, "not_found");
    expectError(await patch(w.stranger, w.p, w.i, c, textBody("x", -1000)), 404, "not_found");
    expectError(await del(w.stranger, w.p, w.i, c), 404, "not_found");
    expectError(await list(w.author, w.p, randomUUID()), 404, "not_found");
    expectError(await del(w.author, w.p, w.i, randomUUID()), 404, "not_found");
    // A comment id from another idea is not found under this one.
    const j = (await prisma.idea.create({ data: { id: randomUUID(), projectId: w.p, authorId: w.author.id, title: "J" } })).id;
    expectError(await del(w.author, w.p, j, c), 404, "not_found");
  });

  it("creates a comment with its author, no edited flag, and no remindWith field", async () => {
    const w = await world();
    const id = randomUUID();
    const res = await post(w.other, w.p, w.i, { id, text: "  Great idea  " });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id,
      ideaId: w.i,
      author: { id: w.other.id, displayName: "Bob" },
      text: "Great idea",
      edited: false,
      createdAt: clock.now().toISOString(),
    });
    expect(res.body).not.toHaveProperty("remindWith");
    const all = await list(w.author, w.p, w.i);
    expect(all.body.comments).toHaveLength(1);
    expect(all.body.comments[0]).not.toHaveProperty("remindWith");
  });

  it("refuses empty, over-long, extra and remindWith fields", async () => {
    const w = await world();
    for (const body of [
      { text: "" },
      { text: "   " },
      { text: "x".repeat(1001) },
      { remindWith: true },
      { surprise: 1 },
    ]) {
      expectError(await post(w.author, w.p, w.i, body), 400, "validation_failed");
    }
    expect((await post(w.author, w.p, w.i, { text: "x".repeat(1000) })).status).toBe(201);
  });

  it("is idempotent for the same id, and 409 for an id used on another idea", async () => {
    const w = await world();
    const id = randomUUID();
    expect((await post(w.author, w.p, w.i, { id })).status).toBe(201);
    expect((await post(w.author, w.p, w.i, { id, text: "Other" })).status).toBe(200);
    expect(await prisma.ideaComment.count()).toBe(1);
    const j = (await prisma.idea.create({ data: { id: randomUUID(), projectId: w.p, authorId: w.author.id, title: "J" } })).id;
    expectError(await post(w.author, w.p, j, { id }), 409, "id_conflict");
  });

  it("lists oldest first", async () => {
    const w = await world();
    const a = (await post(w.author, w.p, w.i)).body.id as string;
    clock.advanceMs(1000);
    const b = (await post(w.other, w.p, w.i)).body.id as string;
    const res = await list(w.owner, w.p, w.i);
    expect(res.body.comments.map((c: { id: string }) => c.id)).toEqual([a, b]);
  });

  it("lets only the author edit; the edit sets the edited flag", async () => {
    const w = await world();
    const c = (await post(w.other, w.p, w.i)).body.id as string;
    expectError(await patch(w.author, w.p, w.i, c, textBody("Hijack")), 403, "forbidden");
    expectError(await patch(w.owner, w.p, w.i, c, textBody("Hijack")), 403, "forbidden");
    const res = await patch(w.other, w.p, w.i, c, textBody("Changed"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ text: "Changed", edited: true });
  });

  it("keeps the newer text: an older edit loses and does not flag", async () => {
    const w = await world();
    const c = (await post(w.other, w.p, w.i)).body.id as string;
    await patch(w.other, w.p, w.i, c, textBody("Newer", -1000));
    const res = await patch(w.other, w.p, w.i, c, textBody("Older", -5000));
    expect(res.body.text).toBe("Newer");
  });

  it("refuses an empty patch, remindWith and bad text", async () => {
    const w = await world();
    const c = (await post(w.other, w.p, w.i)).body.id as string;
    for (const body of [
      {},
      textBody(""),
      textBody("x".repeat(1001)),
      { remindWith: { value: true, editedAt: iso(-1000) } },
    ]) {
      expectError(await patch(w.other, w.p, w.i, c, body), 400, "validation_failed");
    }
  });

  it("lets only the author delete", async () => {
    const w = await world();
    const c = (await post(w.other, w.p, w.i)).body.id as string;
    expectError(await del(w.owner, w.p, w.i, c), 403, "forbidden");
    expect((await del(w.other, w.p, w.i, c)).status).toBe(204);
    expectError(await del(w.other, w.p, w.i, c), 404, "not_found");
  });

  it("refuses the 501st comment with comment_limit_reached", async () => {
    const w = await world();
    await prisma.ideaComment.createMany({
      data: Array.from({ length: MAX_COMMENTS_PER_IDEA }, () => ({
        id: randomUUID(), ideaId: w.i, authorId: w.author.id, text: "x",
      })),
    });
    expectError(await post(w.other, w.p, w.i), 409, "comment_limit_reached");
    const existing = await prisma.ideaComment.findFirstOrThrow();
    expect((await post(w.other, w.p, w.i, { id: existing.id })).status).toBe(200);
  });

  it("keeps a removed member's comments, and shows a null author when the account is gone", async () => {
    const w = await world();
    await post(w.other, w.p, w.i);
    await prisma.projectMember.delete({ where: { projectId_userId: { projectId: w.p, userId: w.other.id } } });
    expect((await list(w.author, w.p, w.i)).body.comments).toHaveLength(1);
    await prisma.user.delete({ where: { id: w.other.id } });
    expect((await list(w.author, w.p, w.i)).body.comments[0].author).toBeNull();
  });
});
