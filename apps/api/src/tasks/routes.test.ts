import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
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
import { createApp } from "../app.js";
import { createMembersRouter } from "../members/routes.js";
import { lockProject } from "../projects/access.js";
import { createProjectsRouter } from "../projects/routes.js";
import { createTasksRouter } from "./routes.js";

describe("/projects/:projectId/tasks", () => {
  useTestApp();
  const clock = createClock();
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/tasks", createTasksRouter({ prisma, now: clock.now }));
  app.use("/projects", createProjectsRouter({ prisma, now: clock.now }));
  app.use(createMembersRouter({ prisma, now: clock.now }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  const DAY = 24 * 3600 * 1000;

  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);

  /** Creates a project directly, with `owner` as its Owner and `members` as plain Members. */
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
    return project.id;
  }

  const base = (projectId: string) => `/projects/${projectId}/tasks`;

  function create(u: User, projectId: string, body: Record<string, unknown> = {}) {
    return request(app)
      .post(base(projectId))
      .set(...bearer(u.token))
      .send({ id: randomUUID(), title: "Mua ly", editedAt: iso(), ...body });
  }
  function patch(u: User, projectId: string, taskId: string, fields: Record<string, unknown>) {
    return request(app)
      .patch(`${base(projectId)}/${taskId}`)
      .set(...bearer(u.token))
      .send({ fields });
  }
  const del = (u: User, projectId: string, taskId: string) =>
    request(app).delete(`${base(projectId)}/${taskId}`).set(...bearer(u.token));
  const list = (u: User, projectId: string) =>
    request(app).get(base(projectId)).set(...bearer(u.token));
  const change = (value: unknown, offsetMs = 0) => ({ value, editedAt: iso(offsetMs) });

  describe("validation (AC1)", () => {
    it("rejects bad titles, descriptions, status, id and editedAt", async () => {
      const u = await user();
      const p = await seed(u);
      for (const body of [
        { title: "" },
        { title: "   " },
        { title: "a".repeat(121) },
        { title: " " + "a".repeat(121) + " " },
        { description: "d".repeat(2001) },
        { status: "blocked" },
        { id: "not-a-uuid" },
        { editedAt: "yesterday" },
        { surprise: true },
      ]) {
        expectError(await create(u, p, body), 400, "validation_failed");
      }
      expect(await prisma.task.count()).toBe(0);
    });

    it("refuses control characters; descriptions may keep newline, return and tab", async () => {
      const u = await user();
      const p = await seed(u);
      for (const ch of ["\u0000", "\u0001", "\u001f", "\u007f", "\u0080", "\u009f", "\n", "\r", "\t"]) {
        expectError(await create(u, p, { title: `a${ch}b` }), 400, "validation_failed");
      }
      for (const ch of ["\u0000", "\u0001", "\u001f", "\u007f", "\u0080", "\u009f"]) {
        expectError(await create(u, p, { description: `a${ch}b` }), 400, "validation_failed");
      }
      expect(await prisma.task.count()).toBe(0);
      const ok = await create(u, p, { description: "line1\nline2\r\n\tx" });
      expect(ok.status).toBe(201);
      expect(ok.body.description).toBe("line1\nline2\r\n\tx");
      const t = ok.body.id as string;
      expectError(await patch(u, p, t, { title: change("a\u0000b") }), 400, "validation_failed");
      expectError(await patch(u, p, t, { description: change("a\u0000b") }), 400, "validation_failed");
      expect((await patch(u, p, t, { description: change("x\ny") })).status).toBe(200);
    });

    it("accepts boundary values, every status and no due date", async () => {
      const u = await user();
      const p = await seed(u);
      const a = await create(u, p, { title: "a".repeat(120), description: "" });
      expect(a.status).toBe(201);
      expect(a.body.dueDate).toBeNull();
      expect(a.body.dueTime).toBeNull();
      const b = await create(u, p, { title: "  trimmed  ", description: "d".repeat(2000) });
      expect(b.status).toBe(201);
      expect(b.body.title).toBe("trimmed");
      for (const status of ["todo", "doing", "done"]) {
        const r = await create(u, p, { status });
        expect(r.status).toBe(201);
        expect(r.body.status).toBe(status);
      }
    });

    it("defaults status to todo and description to empty", async () => {
      const u = await user();
      const p = await seed(u);
      const res = await create(u, p);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("todo");
      expect(res.body.description).toBe("");
      expect(res.body.assignees).toEqual([]);
    });

    it("validates patch fields and needs at least one", async () => {
      const u = await user();
      const p = await seed(u);
      const t = (await create(u, p)).body.id as string;
      for (const fields of [
        {},
        { title: change("") },
        { title: change("a".repeat(121)) },
        { description: change("d".repeat(2001)) },
        { status: change("blocked") },
        { title: { value: "x" } },
        { title: change("x"), extra: change("y") },
      ]) {
        expectError(await patch(u, p, t, fields), 400, "validation_failed");
      }
      const row = await prisma.task.findUniqueOrThrow({ where: { id: t } });
      expect(row.title).toBe("Mua ly");
    });
  });

  describe("due date and time (AC2)", () => {
    it("stores and returns a day with a time, and a day only", async () => {
      const u = await user();
      const p = await seed(u);
      const a = await create(u, p, { dueDate: "2026-03-05", dueTime: "09:30" });
      expect(a.status).toBe(201);
      expect(a.body.dueDate).toBe("2026-03-05");
      expect(a.body.dueTime).toBe("09:30");
      const b = await create(u, p, { dueDate: "2026-03-05" });
      expect(b.body.dueDate).toBe("2026-03-05");
      expect(b.body.dueTime).toBeNull();
      // Read back through the list too.
      const listed = (await list(u, p)).body as { id: string; dueDate: string }[];
      expect(listed.find((t) => t.id === a.body.id)?.dueDate).toBe("2026-03-05");
    });

    it("keeps the day exactly as given around midnight and the year end", async () => {
      const u = await user();
      const p = await seed(u);
      for (const dueDate of ["2026-01-01", "2026-12-31", "2028-02-29"]) {
        const r = await create(u, p, { dueDate, dueTime: "23:59" });
        expect(r.body.dueDate).toBe(dueDate);
        expect(r.body.dueTime).toBe("23:59");
      }
    });

    it("refuses a time without a day", async () => {
      const u = await user();
      const p = await seed(u);
      expectError(await create(u, p, { dueTime: "09:30" }), 400, "validation_failed");
      expectError(
        await create(u, p, { dueDate: null, dueTime: "09:30" }),
        400,
        "validation_failed",
      );
      expect(await prisma.task.count()).toBe(0);
    });

    it("refuses dates that are not real days and times that are not HH:mm", async () => {
      const u = await user();
      const p = await seed(u);
      for (const body of [
        { dueDate: "2026-02-30" },
        { dueDate: "2026-13-01" },
        { dueDate: "2026-02-29" },
        { dueDate: "2026-3-5" },
        { dueDate: "05/03/2026" },
        { dueDate: "2026-03-05T00:00:00Z" },
        { dueDate: "2026-03-05", dueTime: "24:00" },
        { dueDate: "2026-03-05", dueTime: "12:60" },
        { dueDate: "2026-03-05", dueTime: "9:30" },
        { dueDate: "2026-03-05", dueTime: "09:30:00" },
      ]) {
        expectError(await create(u, p, body), 400, "validation_failed");
      }
    });

    it("accepts years 1900 and 9999 and refuses years outside them, on create and patch", async () => {
      const u = await user();
      const p = await seed(u);
      for (const dueDate of ["1900-01-01", "9999-12-31"]) {
        const res = await create(u, p, { dueDate });
        expect(res.status).toBe(201);
        expect(res.body.dueDate).toBe(dueDate);
      }
      for (const dueDate of ["0000-01-01", "1899-12-31", "0001-06-15"]) {
        expectError(await create(u, p, { dueDate }), 400, "validation_failed");
      }
      const t = (await create(u, p)).body;
      for (const date of ["0000-01-01", "1899-12-31"]) {
        expectError(await patch(u, p, t.id, { due: change({ date }) }), 400, "validation_failed");
      }
      expect(await prisma.task.count()).toBe(3);
    });

    it("sets, changes and clears the due field through a patch", async () => {
      const u = await user();
      const p = await seed(u);
      const t = (await create(u, p)).body.id as string;
      clock.advanceMs(1000);
      const set = await patch(u, p, t, { due: change({ date: "2026-04-01", time: "08:00" }) });
      expect(set.status).toBe(200);
      expect(set.body.dueDate).toBe("2026-04-01");
      expect(set.body.dueTime).toBe("08:00");
      clock.advanceMs(1000);
      const dayOnly = await patch(u, p, t, { due: change({ date: "2026-04-02" }) });
      expect(dayOnly.body.dueDate).toBe("2026-04-02");
      expect(dayOnly.body.dueTime).toBeNull();
      clock.advanceMs(1000);
      const cleared = await patch(u, p, t, { due: change(null) });
      expect(cleared.body.dueDate).toBeNull();
      expect(cleared.body.dueTime).toBeNull();
    });

    it("refuses a patch with a time and no day", async () => {
      const u = await user();
      const p = await seed(u);
      const t = (await create(u, p)).body.id as string;
      for (const value of [{ time: "09:30" }, { date: null, time: "09:30" }, { date: "2026-02-30" }]) {
        expectError(await patch(u, p, t, { due: change(value) }), 400, "validation_failed");
      }
    });
  });

  describe("task limit (R7)", () => {
    async function fill(projectId: string, n: number, ownerId: string) {
      const t = clock.now();
      await prisma.task.createMany({
        data: Array.from({ length: n }, (_, i) => ({
          id: randomUUID(),
          projectId,
          title: `T${i}`,
          titleEditedAt: t,
          descriptionEditedAt: t,
          statusEditedAt: t,
          dueEditedAt: t,
          assigneesEditedAt: t,
          createdById: ownerId,
        })),
      });
    }

    it("allows the 1000th task, refuses the 1001st with 409 task_limit_reached, and frees a slot on delete", async () => {
      const u = await user();
      const p = await seed(u);
      await fill(p, 999, u.id);
      const last = await create(u, p);
      expect(last.status).toBe(201);
      expectError(await create(u, p), 409, "task_limit_reached");
      expect(await prisma.task.count({ where: { projectId: p } })).toBe(1000);
      expect((await del(u, p, last.body.id)).status).toBe(204);
      expect((await create(u, p)).status).toBe(201);
    });

    it("still answers 200 to a repeat of an existing task's create at the limit", async () => {
      const u = await user();
      const p = await seed(u);
      await fill(p, 999, u.id);
      const id = randomUUID();
      expect((await create(u, p, { id })).status).toBe(201);
      expect((await create(u, p, { id })).status).toBe(200);
    });

    it("counts per project", async () => {
      const u = await user();
      const full = await seed(u);
      const other = await seed(u);
      await fill(full, 1000, u.id);
      expectError(await create(u, full), 409, "task_limit_reached");
      expect((await create(u, other)).status).toBe(201);
    });

    it("never exceeds 1000 when creates race", async () => {
      const u = await user();
      const p = await seed(u);
      await fill(p, 998, u.id);
      const results = await Promise.all([create(u, p), create(u, p), create(u, p)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
      expect(await prisma.task.count({ where: { projectId: p } })).toBe(1000);
    });
  });

  describe("assignees (AC3)", () => {
    it("assigns project members, on create and on patch", async () => {
      const owner = await user();
      const member = await user();
      const p = await seed(owner, [member]);
      const a = await create(owner, p, { assigneeIds: [owner.id, member.id] });
      expect(a.status).toBe(201);
      expect((a.body.assignees as { id: string }[]).map((x) => x.id).sort()).toEqual(
        [owner.id, member.id].sort(),
      );
      const t = (await create(owner, p)).body.id as string;
      clock.advanceMs(1000);
      const r = await patch(owner, p, t, { assignees: change([member.id]) });
      expect(r.status).toBe(200);
      expect(r.body.assignees).toEqual([{ id: member.id, displayName: "Bob" }]);
    });

    it("refuses a non-member, a duplicate and 21 people", async () => {
      const owner = await user();
      const stranger = await user();
      const p = await seed(owner);
      for (const assigneeIds of [
        [stranger.id],
        [owner.id, stranger.id],
        [owner.id, owner.id],
        Array.from({ length: 21 }, () => randomUUID()),
        ["not-a-uuid"],
      ]) {
        expectError(await create(owner, p, { assigneeIds }), 400, "validation_failed");
      }
      expect(await prisma.task.count()).toBe(0);
      expect(await prisma.taskAssignee.count()).toBe(0);
    });

    it("accepts exactly 20 distinct members", async () => {
      const owner = await user();
      const others = await Promise.all(Array.from({ length: 19 }, () => user()));
      const p = await seed(owner, others);
      const ids = [owner.id, ...others.map((o) => o.id)];
      const r = await create(owner, p, { assigneeIds: ids });
      expect(r.status).toBe(201);
      expect(r.body.assignees).toHaveLength(20);
    });

    it("refuses a patch naming a non-member and leaves the task untouched", async () => {
      const owner = await user();
      const member = await user();
      const stranger = await user();
      const p = await seed(owner, [member]);
      const t = (await create(owner, p, { assigneeIds: [member.id] })).body.id as string;
      clock.advanceMs(1000);
      const r = await patch(owner, p, t, {
        title: change("New title"),
        assignees: change([stranger.id]),
      });
      expectError(r, 400, "validation_failed");
      // The whole request rolled back: the earlier title change did not stick either.
      const row = await prisma.task.findUniqueOrThrow({
        where: { id: t },
        include: { assignees: true },
      });
      expect(row.title).toBe("Mua ly");
      expect(row.assignees.map((a) => a.userId)).toEqual([member.id]);
      expect(row.assigneesEditedAt.toISOString()).toBe(iso(-1000));
    });

    it("accepts a patch that keeps or removes an already-assigned former member", async () => {
      const owner = await user();
      const member = await user();
      const former = await user();
      const p = await seed(owner, [member]);
      const t = (await create(owner, p, { assigneeIds: [member.id] })).body.id as string;
      // Legacy data: a person who is no longer in the project is still on the task.
      await prisma.taskAssignee.create({ data: { taskId: t, userId: former.id } });

      clock.advanceMs(1000);
      const kept = await patch(owner, p, t, { assignees: change([former.id, owner.id]) });
      expect(kept.status).toBe(200);
      expect((kept.body.assignees as { id: string }[]).map((a) => a.id).sort()).toEqual(
        [former.id, owner.id].sort(),
      );

      clock.advanceMs(1000);
      const removed = await patch(owner, p, t, { assignees: change([owner.id]) });
      expect(removed.status).toBe(200);
      expect((removed.body.assignees as { id: string }[]).map((a) => a.id)).toEqual([owner.id]);
    });

    it("still refuses adding a non-member, even while keeping a former member", async () => {
      const owner = await user();
      const former = await user();
      const stranger = await user();
      const p = await seed(owner);
      const t = (await create(owner, p)).body.id as string;
      await prisma.taskAssignee.create({ data: { taskId: t, userId: former.id } });
      clock.advanceMs(1000);
      expectError(
        await patch(owner, p, t, { assignees: change([former.id, stranger.id]) }),
        400,
        "validation_failed",
      );
      // A former member who isn't on the task can't be added.
      const t2 = (await create(owner, p)).body.id as string;
      clock.advanceMs(1000);
      expectError(
        await patch(owner, p, t2, { assignees: change([former.id]) }),
        400,
        "validation_failed",
      );
    });

    it("refuses a patch with a duplicate or 21 assignees", async () => {
      const owner = await user();
      const p = await seed(owner);
      const t = (await create(owner, p)).body.id as string;
      expectError(
        await patch(owner, p, t, { assignees: change([owner.id, owner.id]) }),
        400,
        "validation_failed",
      );
      expectError(
        await patch(owner, p, t, {
          assignees: change(Array.from({ length: 21 }, () => randomUUID())),
        }),
        400,
        "validation_failed",
      );
    });
  });

  describe("create and ids (AC4)", () => {
    it("returns the phone-chosen id and sets creator, project and time", async () => {
      const u = await user();
      const p = await seed(u);
      const id = randomUUID();
      const res = await create(u, p, { id });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(id);
      expect(res.body.projectId).toBe(p);
      expect(res.body.createdById).toBe(u.id);
      // createdAt is the database default (now()), as for projects, not the injected clock.
      expect(new Date(res.body.createdAt as string).toISOString()).toBe(res.body.createdAt);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          "assignees",
          "createdAt",
          "createdById",
          "description",
          "dueDate",
          "dueTime",
          "id",
          "projectId",
          "status",
          "title",
        ].sort(),
      );
    });

    it("sending the same create twice leaves one task", async () => {
      const u = await user();
      const p = await seed(u);
      const id = randomUUID();
      const first = await create(u, p, { id });
      const second = await create(u, p, { id, title: "Different" });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(await prisma.task.count()).toBe(1);
    });

    it("handles identical creates sent at the same moment", async () => {
      const u = await user();
      const p = await seed(u);
      const id = randomUUID();
      const results = await Promise.all([create(u, p, { id }), create(u, p, { id })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(await prisma.task.count()).toBe(1);
    });

    it("refuses an id used in another project and leaves that task alone", async () => {
      const a = await user();
      const b = await user();
      const pa = await seed(a);
      const pb = await seed(b);
      const id = randomUUID();
      expect((await create(a, pa, { id, title: "Original" })).status).toBe(201);
      const res = await create(b, pb, { id, title: "Hijack" });
      expectError(res, 409, "id_conflict");
      const row = await prisma.task.findUniqueOrThrow({ where: { id } });
      expect(row.title).toBe("Original");
      expect(row.projectId).toBe(pa);
    });

    it("refuses an id used in another project the caller also belongs to", async () => {
      const u = await user();
      const p1 = await seed(u);
      const p2 = await seed(u);
      const id = randomUUID();
      await create(u, p1, { id });
      expectError(await create(u, p2, { id }), 409, "id_conflict");
      expect(await prisma.task.count({ where: { projectId: p2 } })).toBe(0);
    });

    it("clamps a create's editedAt to the server time", async () => {
      const u = await user();
      const p = await seed(u);
      const res = await create(u, p, { editedAt: iso(DAY) });
      expect(res.status).toBe(201);
      const row = await prisma.task.findUniqueOrThrow({ where: { id: res.body.id } });
      for (const k of [
        "titleEditedAt",
        "descriptionEditedAt",
        "statusEditedAt",
        "dueEditedAt",
        "assigneesEditedAt",
      ] as const) {
        expect(row[k].toISOString()).toBe(iso());
      }
    });
  });

  describe("permissions (AC5, AC6)", () => {
    it("lets a Member create a task, edit every field of an Owner's task and change its status", async () => {
      const owner = await user();
      const member = await user();
      const p = await seed(owner, [member]);
      const mine = await create(member, p);
      expect(mine.status).toBe(201);
      expect(mine.body.createdById).toBe(member.id);

      const t = (await create(owner, p)).body.id as string;
      clock.advanceMs(1000);
      const res = await patch(member, p, t, {
        title: change("Renamed"),
        description: change("More detail"),
        status: change("doing"),
        due: change({ date: "2026-05-01", time: "10:00" }),
        assignees: change([owner.id, member.id]),
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        title: "Renamed",
        description: "More detail",
        status: "doing",
        dueDate: "2026-05-01",
        dueTime: "10:00",
        createdById: owner.id,
      });
      expect(res.body.assignees).toHaveLength(2);

      clock.advanceMs(1000);
      const done = await patch(member, p, t, { status: change("done") });
      expect(done.body.status).toBe("done");
    });

    /**
     * Runs `send` while a transaction holds the project lock, waits until the request is
     * blocked on a database lock, then runs `mutate` and commits. The request only sees the
     * change if it checks under the lock.
     */
    async function underLock(
      projectId: string,
      mutate: () => Promise<unknown>,
      send: () => PromiseLike<request.Response>,
    ): Promise<request.Response> {
      let response: PromiseLike<request.Response> | undefined;
      await prisma.$transaction(async (tx) => {
        await lockProject(tx, projectId);
        response = Promise.resolve(send());
        const deadline = Date.now() + 5000;
        for (;;) {
          const rows = await tx.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND datname = current_database()`;
          if (Number(rows[0]!.n) > 0) break;
          if (Date.now() > deadline) throw new Error("request never blocked on the project lock");
          await new Promise((r) => setTimeout(r, 20));
        }
        await mutate();
      }, { timeout: 15000 });
      return await response!;
    }

    it("checks the creator-or-owner rule under the project lock: a demoted owner can't delete", async () => {
      const owner = await user();
      const other = await user();
      const p = await seed(owner);
      await addMember(p, other.id, "owner");
      const t = (await create(other, p)).body.id as string;
      const res = await underLock(
        p,
        () =>
          prisma.projectMember.update({
            where: { projectId_userId: { projectId: p, userId: owner.id } },
            data: { role: "member" },
          }),
        () => del(owner, p, t),
      );
      expectError(res, 403, "forbidden");
      expect(await prisma.task.count({ where: { id: t } })).toBe(1);
    }, 30000);

    it("checks membership under the project lock: a removed member's create, patch and delete are 404", async () => {
      const owner = await user();
      const member = await user();
      const p = await seed(owner, [member]);
      const t = (await create(member, p)).body.id as string;
      const removeMember = () =>
        prisma.projectMember.delete({
          where: { projectId_userId: { projectId: p, userId: member.id } },
        });
      const newId = randomUUID();
      expectError(
        await underLock(p, removeMember, () => create(member, p, { id: newId })),
        404,
        "not_found",
      );
      await addMember(p, member.id, "member");
      expectError(
        await underLock(p, removeMember, () => patch(member, p, t, { title: change("x") })),
        404,
        "not_found",
      );
      await addMember(p, member.id, "member");
      expectError(await underLock(p, removeMember, () => del(member, p, t)), 404, "not_found");
      expect(await prisma.task.count({ where: { id: newId } })).toBe(0);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).title).toBe("Mua ly");
  }, 30000);

    it("lets the creator and an Owner delete; a second delete is 404", async () => {
      const owner = await user();
      const member = await user();
      const p = await seed(owner, [member]);
      const byMember = (await create(member, p)).body.id as string;
      const byOwner = (await create(owner, p)).body.id as string;

      expect((await del(member, p, byMember)).status).toBe(204);
      expect(await prisma.task.count({ where: { id: byMember } })).toBe(0);
      expectError(await del(member, p, byMember), 404, "not_found");

      expect((await del(owner, p, byOwner)).status).toBe(204);
      expectError(await del(owner, p, byOwner), 404, "not_found");
    });

    it("lets an Owner delete a task a Member created", async () => {
      const owner = await user();
      const member = await user();
      const p = await seed(owner, [member]);
      const t = (await create(member, p, { assigneeIds: [member.id] })).body.id as string;
      expect((await del(owner, p, t)).status).toBe(204);
      expect(await prisma.task.count()).toBe(0);
      expect(await prisma.taskAssignee.count()).toBe(0);
    });

    it("gives a Member who didn't create the task 403 and keeps the task", async () => {
      const owner = await user();
      const member = await user();
      const p = await seed(owner, [member]);
      const t = (await create(owner, p)).body.id as string;
      expectError(await del(member, p, t), 403, "forbidden");
      expect(await prisma.task.count({ where: { id: t } })).toBe(1);
    });
  });

  describe("reading (AC7)", () => {
    it("returns exactly this project's tasks with every field and display names", async () => {
      const owner = await user();
      const member = await user();
      await prisma.user.update({ where: { id: member.id }, data: { displayName: "Linh" } });
      const p = await seed(owner, [member]);
      const other = await seed(owner);
      const a = await create(owner, p, {
        title: "A",
        description: "desc",
        status: "doing",
        dueDate: "2026-06-01",
        dueTime: "07:15",
        assigneeIds: [member.id],
      });
      clock.advanceMs(1000);
      const b = await create(owner, p, { title: "B" });
      await create(owner, other, { title: "Elsewhere" });

      const res = await list(member, p);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((t: { title: string }) => t.title)).toEqual(["A", "B"]);
      expect(res.body[0]).toEqual({
        id: a.body.id,
        projectId: p,
        title: "A",
        description: "desc",
        status: "doing",
        dueDate: "2026-06-01",
        dueTime: "07:15",
        assignees: [{ id: member.id, displayName: "Linh" }],
        createdById: owner.id,
        createdAt: a.body.createdAt,
      });
      expect(res.body[1].id).toBe(b.body.id);
      expect(res.body[1].assignees).toEqual([]);
    });

    it("returns an empty list for a project with no tasks", async () => {
      const u = await user();
      const p = await seed(u);
      const res = await list(u, p);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("not found (AC9)", () => {
    it("gives one body for a non-member, a missing project and a task from another project", async () => {
      const owner = await user();
      const stranger = await user();
      const p = await seed(owner);
      const other = await seed(stranger);
      const t = (await create(owner, p)).body.id as string;
      const taskElsewhere = (await create(stranger, other)).body.id as string;
      const missing = randomUUID();

      const projectResults = [
        // Not a member of p.
        await list(stranger, p),
        await create(stranger, p),
        await patch(stranger, p, t, { title: change("x") }),
        await del(stranger, p, t),
        // Project that doesn't exist.
        await list(stranger, missing),
        await create(stranger, missing),
        await patch(stranger, missing, t, { title: change("x") }),
        await del(stranger, missing, t),
        // A project id that isn't a uuid.
        await list(stranger, "nope"),
        await create(stranger, "nope"),
        await patch(stranger, "nope", t, { title: change("x") }),
        await del(stranger, "nope", t),
      ];
      for (const r of projectResults) expectError(r, 404, "not_found");
      for (const r of projectResults) expect(r.body).toEqual(projectResults[0]!.body);

      const taskResults = [
        // A task that belongs to another project (the caller is a member of both).
        await patch(owner, p, taskElsewhere, { title: change("x") }),
        await del(owner, p, taskElsewhere),
        // A task that doesn't exist, and an id that isn't a uuid.
        await patch(owner, p, missing, { title: change("x") }),
        await del(owner, p, missing),
        await patch(owner, p, "nope", { title: change("x") }),
        await del(owner, p, "nope"),
      ];
      await addMember(other, owner.id, "owner");
      taskResults.push(
        await patch(owner, p, taskElsewhere, { title: change("x") }),
        await del(owner, p, taskElsewhere),
      );
      for (const r of taskResults) expectError(r, 404, "not_found");
      // One identical body across project and task cases alike (R9), the member list's included.
      const memberRoute = await request(app)
        .get(`/projects/${p}/members`)
        .set(...bearer(stranger.token));
      expectError(memberRoute, 404, "not_found");
      for (const r of [...projectResults, ...taskResults]) {
        expect(r.body).toEqual(memberRoute.body);
      }

      // Nothing changed.
      const row = await prisma.task.findUniqueOrThrow({ where: { id: taskElsewhere } });
      expect(row.title).toBe("Mua ly");
      expect(await prisma.task.count()).toBe(2);
      expect((await list(owner, p)).body).toHaveLength(1);
    });

    it("answers 404 for a non-member before it looks at the body", async () => {
      const owner = await user();
      const stranger = await user();
      const p = await seed(owner);
      const t = (await create(owner, p)).body.id as string;
      expectError(await create(stranger, p, { title: "" }), 404, "not_found");
      const res = await request(app)
        .patch(`${base(p)}/${t}`)
        .set(...bearer(stranger.token))
        .send({ fields: {} });
      expectError(res, 404, "not_found");
    });

    it("reveals nothing about a task id another project's member probes", async () => {
      const owner = await user();
      const stranger = await user();
      const p = await seed(owner);
      const t = (await create(owner, p)).body.id as string;
      const existing = await del(stranger, p, t);
      const absent = await del(stranger, p, randomUUID());
      expectError(existing, 404, "not_found");
      expect(existing.body).toEqual(absent.body);
    });
  });

  describe("authentication (AC10)", () => {
    it("requires a valid token on every route", async () => {
      const u = await user();
      const p = await seed(u);
      const t = (await create(u, p)).body.id as string;
      clock.advanceMs(SESSION_LIFETIME_MS + 1000);
      const calls = (token?: string) => {
        const set = (r: request.Test) => (token ? r.set(...bearer(token)) : r);
        return [
          set(request(app).get(base(p))),
          set(request(app).post(base(p))).send({}),
          set(request(app).patch(`${base(p)}/${t}`)).send({}),
          set(request(app).delete(`${base(p)}/${t}`)),
        ];
      };
      for (const r of await Promise.all(calls())) expectError(r, 401, "not_signed_in");
      for (const r of await Promise.all(calls(u.token))) expectError(r, 401, "not_signed_in");
      expect(await prisma.task.count()).toBe(1);
    });
  });

  describe("routing", () => {
    it("looks the session up once per task request in the real app", async () => {
      const u = await user();
      const p = await seed(u);
      const real = createApp({ prisma, now: clock.now });
      const spy = vi.spyOn(prisma.session, "findUnique");
      try {
        const res = await request(real).get(base(p)).set(...bearer(u.token));
        expect(res.status).toBe(200);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("cascades (AC11)", () => {
    it("deleting a project removes its tasks and assignments", async () => {
      const owner = await user();
      const p = await seed(owner);
      await create(owner, p, { assigneeIds: [owner.id] });
      await create(owner, p);
      expect(await prisma.task.count()).toBe(2);
      await prisma.project.delete({ where: { id: p } });
      expect(await prisma.task.count()).toBe(0);
      expect(await prisma.taskAssignee.count()).toBe(0);
    });

    it("deleting a user removes their assignments and leaves their tasks without a creator", async () => {
      const owner = await user();
      const member = await user();
      const p = await seed(owner, [member]);
      const t = (await create(member, p, { assigneeIds: [member.id, owner.id] })).body
        .id as string;

      await prisma.user.delete({ where: { id: member.id } });

      const row = await prisma.task.findUniqueOrThrow({
        where: { id: t },
        include: { assignees: true },
      });
      expect(row.createdById).toBeNull();
      expect(row.assignees.map((a) => a.userId)).toEqual([owner.id]);

      const read = await list(owner, p);
      expect(read.body[0].createdById).toBeNull();
      expect(read.body[0].assignees).toEqual([{ id: owner.id, displayName: "Bob" }]);
    });

    it("lets only an Owner delete a task whose creator is gone", async () => {
      const owner = await user();
      const member = await user();
      const other = await user();
      const p = await seed(owner, [member, other]);
      const t = (await create(member, p)).body.id as string;
      await prisma.user.delete({ where: { id: member.id } });

      expectError(await del(other, p, t), 403, "forbidden");
      expect(await prisma.task.count({ where: { id: t } })).toBe(1);
      expect((await del(owner, p, t)).status).toBe(204);
    });
  });

  describe("last write wins (AC12, AC13)", () => {
    it("ignores an older status while accepting a newer title in the same request", async () => {
      const u = await user();
      const p = await seed(u);
      const t = (await create(u, p, { status: "doing" })).body.id as string;
      clock.advanceMs(10_000);
      // A status edit made before the create's time, and a title edit made after it.
      const res = await patch(u, p, t, {
        status: change("done", -20_000),
        title: change("Newer title", -1000),
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("doing");
      expect(res.body.title).toBe("Newer title");
    });

    it("judges each field on its own stored time", async () => {
      const u = await user();
      const p = await seed(u);
      const t = (await create(u, p)).body.id as string;
      clock.advanceMs(10_000);
      await patch(u, p, t, { title: change("Late title") });
      // An edit older than the title's time still lands on a field that is older.
      const res = await patch(u, p, t, {
        title: change("Early title", -5000),
        description: change("Fresh note", -5000),
      });
      expect(res.body.title).toBe("Late title");
      expect(res.body.description).toBe("Fresh note");
    });

    it("stores a change dated one day ahead with the server's current time", async () => {
      const u = await user();
      const p = await seed(u);
      const t = (await create(u, p)).body.id as string;
      clock.advanceMs(1000);
      const res = await patch(u, p, t, {
        title: change("From the future", DAY),
        due: change({ date: "2026-07-01" }, DAY),
        assignees: change([u.id], DAY),
      });
      expect(res.body.title).toBe("From the future");
      const row = await prisma.task.findUniqueOrThrow({ where: { id: t } });
      expect(row.titleEditedAt.toISOString()).toBe(iso());
      expect(row.dueEditedAt.toISOString()).toBe(iso());
      expect(row.assigneesEditedAt.toISOString()).toBe(iso());

      // A later honest edit made after "now" beats the clamped one, not the future one.
      clock.advanceMs(2000);
      const next = await patch(u, p, t, { title: change("Honest") });
      expect(next.body.title).toBe("Honest");
    });

    it("replaces the assignees as a whole set when the change is newer", async () => {
      const owner = await user();
      const m1 = await user();
      const m2 = await user();
      const p = await seed(owner, [m1, m2]);
      const t = (await create(owner, p, { assigneeIds: [owner.id, m1.id] })).body.id as string;
      clock.advanceMs(1000);
      const res = await patch(owner, p, t, { assignees: change([m2.id]) });
      expect(res.body.assignees.map((a: { id: string }) => a.id)).toEqual([m2.id]);
      expect(await prisma.taskAssignee.count({ where: { taskId: t } })).toBe(1);

      clock.advanceMs(1000);
      const emptied = await patch(owner, p, t, { assignees: change([]) });
      expect(emptied.body.assignees).toEqual([]);
    });

    it("keeps the assignees and does not check them when the change is older", async () => {
      const owner = await user();
      const m1 = await user();
      const stranger = await user();
      const p = await seed(owner, [m1]);
      const t = (await create(owner, p, { assigneeIds: [m1.id] })).body.id as string;
      clock.advanceMs(10_000);
      await patch(owner, p, t, { assignees: change([owner.id]) });
      const res = await patch(owner, p, t, { assignees: change([m1.id], -5000) });
      expect(res.status).toBe(200);
      expect(res.body.assignees.map((a: { id: string }) => a.id)).toEqual([owner.id]);
      // An older change is ignored whole, so it can't be used to probe who exists.
      const old = await patch(owner, p, t, { assignees: change([stranger.id], -5000) });
      expect(old.status).toBe(200);
      expect(old.body.assignees.map((a: { id: string }) => a.id)).toEqual([owner.id]);
    });

    it("keeps the due date and time together when the change is older", async () => {
      const u = await user();
      const p = await seed(u);
      const t = (await create(u, p)).body.id as string;
      clock.advanceMs(10_000);
      await patch(u, p, t, { due: change({ date: "2026-08-01", time: "10:00" }) });
      const res = await patch(u, p, t, { due: change({ date: "2026-09-09" }, -5000) });
      expect(res.body.dueDate).toBe("2026-08-01");
      expect(res.body.dueTime).toBe("10:00");
    });

    it("an equal time does not win", async () => {
      const u = await user();
      const p = await seed(u);
      const t = (await create(u, p)).body.id as string;
      const res = await patch(u, p, t, { title: change("Same moment") });
      expect(res.body.title).toBe("Mua ly");
    });

    it("answers 200 with the current values when every change is ignored", async () => {
      const u = await user();
      const p = await seed(u);
      const created = await create(u, p, { title: "Keep me", status: "doing" });
      const t = created.body.id as string;
      clock.advanceMs(10_000);
      const res = await patch(u, p, t, {
        title: change("Old", -15_000),
        description: change("Old", -15_000),
        status: change("done", -15_000),
        due: change({ date: "2026-01-01" }, -15_000),
        assignees: change([u.id], -15_000),
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(created.body);
    });
  });
});
