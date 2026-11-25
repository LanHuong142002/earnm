import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createSession } from "../auth/sessions.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { recordActivity } from "./record.js";

// Ticket #16: notification settings and the activity feed. Everything is scoped to the caller.
describe("activity routes", () => {
  useTestApp();
  const clock = createClock();
  const app = createApp({ prisma, now: clock.now });

  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);
  const bearer = (u: User): [string, string] => ["Authorization", `Bearer ${u.token}`];
  const DAY = 24 * 60 * 60 * 1000;
  const ago = (ms: number) => new Date(clock.now().getTime() - ms);

  async function project(owner: User, members: User[] = []) {
    const t = clock.now();
    const p = await prisma.project.create({
      data: { id: randomUUID(), name: "Bếp", currency: "VND", nameEditedAt: t, descriptionEditedAt: t, currencyEditedAt: t },
    });
    await addMember(p.id, owner.id, "owner");
    for (const m of members) await addMember(p.id, m.id, "member");
    return p.id;
  }

  async function event(
    projectId: string,
    recipients: User[],
    opts: { occurredAt?: Date; type?: "assigned" | "comment" | "done" | "idea" | "member_joined"; actorId?: string | null; id?: string; title?: string; readAt?: Date } = {},
  ) {
    const occurredAt = opts.occurredAt ?? clock.now();
    const e = await prisma.activityEvent.create({
      data: {
        ...(opts.id ? { id: opts.id } : {}),
        projectId,
        type: opts.type ?? "assigned",
        actorId: opts.actorId ?? null,
        subjectTitle: opts.title ?? "Mua ly",
        occurredAt,
      },
    });
    await prisma.activityRecipient.createMany({
      data: recipients.map((r) => ({
        eventId: e.id,
        userId: r.id,
        occurredAt,
        pushState: "late" as const,
        ...(opts.readAt ? { readAt: opts.readAt } : {}),
      })),
    });
    return e.id;
  }

  const feed = (u: User, cursor?: string) =>
    request(app).get("/me/activity").query(cursor ? { cursor } : {}).set(...bearer(u));
  const ids = (res: request.Response) => (res.body.items as { id: string }[]).map((i) => i.id);

  describe("sign-in (AC23, AC35)", () => {
    it("answers 401 to every endpoint when signed out", async () => {
      const id = randomUUID();
      const calls = [
        request(app).get("/me/notification-settings"),
        request(app).put("/me/notification-settings/types/comment").send({ enabled: false }),
        request(app).put(`/projects/${id}/notification-mute`).send({ muted: true }),
        request(app).get("/me/activity"),
        request(app).get("/me/activity/unread"),
        request(app).post("/me/activity/read").send({ eventIds: [id] }),
        request(app).post("/me/activity/read-all"),
      ];
      for (const call of calls) expectError(await call, 401, "not_signed_in");
    });
  });

  describe("settings (AC17, AC21)", () => {
    it("starts with every type on and no project muted", async () => {
      const u = await user();
      const res = await request(app).get("/me/notification-settings").set(...bearer(u));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        types: { assigned: true, comment: true, done: true, idea: true, member_joined: true },
        mutedProjectIds: [],
      });
    });

    it("turns a type off and on, idempotently, returning the full settings", async () => {
      const u = await user();
      const put = (enabled: boolean) =>
        request(app).put("/me/notification-settings/types/comment").set(...bearer(u)).send({ enabled });
      for (let i = 0; i < 2; i++) {
        const off = await put(false);
        expect(off.status).toBe(200);
        expect(off.body.types).toEqual({ assigned: true, comment: false, done: true, idea: true, member_joined: true });
      }
      expect(await prisma.notificationTypeMute.count({ where: { userId: u.id } })).toBe(1);
      for (let i = 0; i < 2; i++) {
        const on = await put(true);
        expect(on.body.types.comment).toBe(true);
      }
      expect(await prisma.notificationTypeMute.count({ where: { userId: u.id } })).toBe(0);
    });

    it("rejects an unknown type or a bad body with 400", async () => {
      const u = await user();
      const bad = await request(app).put("/me/notification-settings/types/bogus").set(...bearer(u)).send({ enabled: false });
      expectError(bad, 400, "validation_failed");
      const body = await request(app).put("/me/notification-settings/types/done").set(...bearer(u)).send({ enabled: "no" });
      expectError(body, 400, "validation_failed");
    });

    it("keeps settings across sessions of the same user and apart from other users", async () => {
      const u = await user();
      const other = await user();
      const p = await project(u);
      await request(app).put("/me/notification-settings/types/idea").set(...bearer(u)).send({ enabled: false });
      await request(app).put(`/projects/${p}/notification-mute`).set(...bearer(u)).send({ muted: true });
      // A second session for the same user.
      const token2 = await createSession(prisma, u.id, clock.now());
      expect(token2).not.toBe(u.token);
      const res = await request(app).get("/me/notification-settings").set("Authorization", `Bearer ${token2}`);
      expect(res.body.types.idea).toBe(false);
      expect(res.body.mutedProjectIds).toEqual([p]);
      const theirs = await request(app).get("/me/notification-settings").set(...bearer(other));
      expect(theirs.body.types.idea).toBe(true);
      expect(theirs.body.mutedProjectIds).toEqual([]);
    });
  });

  describe("project mute (AC23)", () => {
    it("mutes and unmutes a project the caller is in, repeating harmlessly", async () => {
      const u = await user();
      const p = await project(u);
      const put = (muted: boolean) => request(app).put(`/projects/${p}/notification-mute`).set(...bearer(u)).send({ muted });
      for (let i = 0; i < 2; i++) {
        const res = await put(true);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ muted: true });
      }
      expect(await prisma.projectNotificationMute.count({ where: { userId: u.id } })).toBe(1);
      for (let i = 0; i < 2; i++) expect((await put(false)).body).toEqual({ muted: false });
      expect(await prisma.projectNotificationMute.count({ where: { userId: u.id } })).toBe(0);
    });

    it("identical concurrent mute requests all succeed with one row (R23)", async () => {
      const u = await user();
      const p = await project(u);
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          request(app).put(`/projects/${p}/notification-mute`).set(...bearer(u)).send({ muted: true }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(12).fill(200));
      expect(results.every((r) => r.body.muted === true)).toBe(true);
      expect(await prisma.projectNotificationMute.count({ where: { userId: u.id } })).toBe(1);
    });

    it("identical concurrent type-mute requests all succeed with the same settings (R23)", async () => {
      const u = await user();
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          request(app).put("/me/notification-settings/types/comment").set(...bearer(u)).send({ enabled: false }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(12).fill(200));
      expect(await prisma.notificationTypeMute.count({ where: { userId: u.id } })).toBe(1);
    });

    it("answers 404 not_found for a project the caller is not in, an unknown one, or a bad id", async () => {
      const owner = await user();
      const outsider = await user();
      const p = await project(owner);
      const attempts = [p, randomUUID(), "nope"];
      for (const id of attempts) {
        const res = await request(app).put(`/projects/${id}/notification-mute`).set(...bearer(outsider)).send({ muted: true });
        expectError(res, 404, "not_found");
      }
      expect(await prisma.projectNotificationMute.count()).toBe(0);
    });

    it("lists a muted project only while the caller is still a member", async () => {
      const owner = await user();
      const m = await user();
      const p = await project(owner, [m]);
      await request(app).put(`/projects/${p}/notification-mute`).set(...bearer(m)).send({ muted: true });
      await prisma.projectMember.deleteMany({ where: { projectId: p, userId: m.id } });
      const res = await request(app).get("/me/notification-settings").set(...bearer(m));
      expect(res.body.mutedProjectIds).toEqual([]);
    });
  });

  describe("feed (AC29, AC33, AC35)", () => {
    it("returns the item shape, newest first, with actor and member names", async () => {
      const a = await user();
      const b = await user();
      await prisma.user.update({ where: { id: a.id }, data: { displayName: "Anna" } });
      const p = await project(a, [b]);
      const older = await event(p, [b], { occurredAt: ago(2 * DAY), actorId: a.id, title: "Cũ" });
      const joined = await prisma.activityEvent.create({
        data: { projectId: p, type: "member_joined", actorId: null, memberId: a.id, subjectTitle: "", occurredAt: ago(DAY) },
      });
      await prisma.activityRecipient.create({ data: { eventId: joined.id, userId: b.id, occurredAt: ago(DAY), pushState: "late" } });
      const res = await feed(b);
      expect(res.status).toBe(200);
      expect(ids(res)).toEqual([joined.id, older]);
      expect(res.body.nextCursor).toBeNull();
      expect(res.body.items[1]).toEqual({
        id: older, type: "assigned", actorName: "Anna", subjectTitle: "Cũ", projectId: p, projectName: "Bếp",
        taskId: null, ideaId: null, memberId: null, memberName: null, occurredAt: ago(2 * DAY).toISOString(), read: false,
      });
      expect(res.body.items[0]).toMatchObject({ type: "member_joined", actorName: null, memberId: a.id, memberName: "Anna" });
    });

    it("pages 30 at a time by cursor, stable with equal occurredAt, nothing older than 30 days", async () => {
      const a = await user();
      const p = await project(a);
      const same = ago(DAY);
      const made: string[] = [];
      for (let i = 0; i < 35; i++) made.push(await event(p, [a], { occurredAt: i < 10 ? same : ago(DAY + i * 1000) }));
      await event(p, [a], { occurredAt: ago(31 * DAY) });
      const first = await feed(a);
      expect(first.body.items).toHaveLength(30);
      expect(first.body.nextCursor).toEqual(expect.any(String));
      const second = await feed(a, first.body.nextCursor);
      expect(second.body.items).toHaveLength(5);
      expect(second.body.nextCursor).toBeNull();
      const all = [...ids(first), ...ids(second)];
      expect(new Set(all).size).toBe(35);
      expect(new Set(all)).toEqual(new Set(made));
      const times = [...first.body.items, ...second.body.items].map((i: { occurredAt: string }) => i.occurredAt);
      expect([...times].sort().reverse()).toEqual(times);
      // Equal times sort by event id, newest id first.
      const tied = [...first.body.items, ...second.body.items].filter((i: { occurredAt: string }) => i.occurredAt === same.toISOString());
      expect(tied.map((i: { id: string }) => i.id)).toEqual(tied.map((i: { id: string }) => i.id).sort().reverse());
    });

    it("rejects a cursor that is not one of ours with 400", async () => {
      const a = await user();
      const junk = ["!!!", "abc", Buffer.from("x|y").toString("base64url"), Buffer.from(`${new Date().toISOString()}|nope`).toString("base64url")];
      for (const c of junk) expectError(await feed(a, c), 400, "validation_failed");
    });

    it("shows events from muted types and projects, and a late event at its own time", async () => {
      const a = await user();
      const b = await user();
      const p = await project(a, [b]);
      await request(app).put("/me/notification-settings/types/comment").set(...bearer(b)).send({ enabled: false });
      await request(app).put(`/projects/${p}/notification-mute`).set(...bearer(b)).send({ muted: true });
      const mid = await event(p, [b], { occurredAt: ago(3 * 60 * 60 * 1000), type: "comment" });
      const newer = await event(p, [b], { occurredAt: ago(60 * 1000) });
      const late = await prisma.$transaction((tx) =>
        recordActivity(tx, {
          type: "assigned", projectId: p, actorId: a.id, taskId: null, ideaId: null, memberId: null,
          subjectTitle: "Muộn", occurredAt: ago(2 * 60 * 60 * 1000), recipients: [b.id], now: clock.now(),
        }),
      );
      expect(late).toBeNull(); // a late event is never pushed
      const res = await feed(b);
      expect(res.body.items.map((i: { subjectTitle: string }) => i.subjectTitle)).toEqual(["Mua ly", "Muộn", "Mua ly"]);
      expect(ids(res)[0]).toBe(newer);
      expect(ids(res)[2]).toBe(mid);
    });

    it("drops a project's events once the caller leaves, and brings them back on rejoin", async () => {
      const a = await user();
      const b = await user();
      const p = await project(a, [b]);
      const q = await project(a, [b]);
      await event(p, [b]);
      const keep = await event(q, [b]);
      await prisma.projectMember.deleteMany({ where: { projectId: p, userId: b.id } });
      expect(ids(await feed(b))).toEqual([keep]);
      expect((await request(app).get("/me/activity/unread").set(...bearer(b))).body).toEqual({ hasUnread: true });
      await prisma.projectMember.deleteMany({ where: { projectId: q, userId: b.id } });
      expect(ids(await feed(b))).toEqual([]);
      expect((await request(app).get("/me/activity/unread").set(...bearer(b))).body).toEqual({ hasUnread: false });
    });

    it("never shows another user's rows (AC35)", async () => {
      const a = await user();
      const b = await user();
      const p = await project(a, [b]);
      await event(p, [a]);
      expect((await feed(b)).body).toEqual({ items: [], nextCursor: null });
      expect((await request(app).get("/me/activity/unread").set(...bearer(b))).body).toEqual({ hasUnread: false });
    });
  });

  describe("unread and read (AC31, AC35)", () => {
    it("ignores events older than 30 days for the dot", async () => {
      const a = await user();
      const p = await project(a);
      await event(p, [a], { occurredAt: ago(31 * DAY) });
      const res = await request(app).get("/me/activity/unread").set(...bearer(a));
      expect(res.body).toEqual({ hasUnread: false });
    });

    it("marks events read, visible from another session, and the dot clears", async () => {
      const a = await user();
      const p = await project(a);
      const e1 = await event(p, [a], { occurredAt: ago(2000) });
      const e2 = await event(p, [a], { occurredAt: ago(1000) });
      const mark = await request(app).post("/me/activity/read").set(...bearer(a)).send({ eventIds: [e1] });
      expect(mark.status).toBe(204);
      const again = await request(app).post("/me/activity/read").set(...bearer(a)).send({ eventIds: [e1] });
      expect(again.status).toBe(204);
      const res = await feed(a);
      expect(res.body.items.map((i: { id: string; read: boolean }) => [i.id, i.read])).toEqual([[e2, false], [e1, true]]);
      expect((await request(app).get("/me/activity/unread").set(...bearer(a))).body).toEqual({ hasUnread: true });
      await request(app).post("/me/activity/read").set(...bearer(a)).send({ eventIds: [e2] });
      expect((await request(app).get("/me/activity/unread").set(...bearer(a))).body).toEqual({ hasUnread: false });
    });

    it("read-all marks every unread row of the caller only", async () => {
      const a = await user();
      const b = await user();
      const p = await project(a, [b]);
      const mine = await event(p, [a, b]);
      await event(p, [a]);
      const res = await request(app).post("/me/activity/read-all").set(...bearer(a));
      expect(res.status).toBe(204);
      expect((await feed(a)).body.items.every((i: { read: boolean }) => i.read)).toBe(true);
      expect((await feed(b)).body.items.map((i: { id: string; read: boolean }) => [i.id, i.read])).toEqual([[mine, false]]);
    });

    it("answers 204 whatever the ids, and changes nothing for someone else's event (AC35)", async () => {
      const a = await user();
      const b = await user();
      const p = await project(a, [b]);
      const aOnly = await event(p, [a]);
      const mine = await request(app).post("/me/activity/read").set(...bearer(a)).send({ eventIds: [randomUUID()] });
      const theirs = await request(app).post("/me/activity/read").set(...bearer(b)).send({ eventIds: [aOnly] });
      expect(theirs.status).toBe(204);
      expect(theirs.status).toBe(mine.status);
      expect(theirs.text).toBe(mine.text);
      expect((await feed(a)).body.items[0].read).toBe(false);
    });

    it("rejects an empty list, too many ids, or non-uuid ids with 400", async () => {
      const a = await user();
      const post = (eventIds: unknown) => request(app).post("/me/activity/read").set(...bearer(a)).send({ eventIds });
      expectError(await post([]), 400, "validation_failed");
      expectError(await post(["x"]), 400, "validation_failed");
      expectError(await post(Array.from({ length: 101 }, () => randomUUID())), 400, "validation_failed");
    });
  });
});
