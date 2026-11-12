import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppError } from "../http/errors.js";
import { createClock, createSignedInUser, prisma, useTestApp } from "../test/helpers.js";
import { findForMember, lockProject, requireOwner } from "./access.js";

describe("project access helpers", () => {
  useTestApp();
  const clock = createClock();

  async function seedProject(ownerId: string, memberIds: string[] = []) {
    const project = await prisma.project.create({
      data: {
        id: randomUUID(),
        name: "P",
        currency: "VND",
        nameEditedAt: clock.now(),
        descriptionEditedAt: clock.now(),
        currencyEditedAt: clock.now(),
        members: {
          create: [
            { userId: ownerId, role: "owner" },
            ...memberIds.map((userId) => ({ userId, role: "member" as const })),
          ],
        },
      },
    });
    return project.id;
  }

  async function rejection(p: Promise<unknown>): Promise<AppError> {
    try {
      await p;
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      return err as AppError;
    }
    throw new Error("Expected a rejection.");
  }

  describe("findForMember", () => {
    it("returns the project and role for a member, null otherwise", async () => {
      const owner = await createSignedInUser(clock);
      const member = await createSignedInUser(clock);
      const outsider = await createSignedInUser(clock);
      const id = await seedProject(owner.id, [member.id]);

      expect((await findForMember(prisma, id, owner.id))?.role).toBe("owner");
      expect((await findForMember(prisma, id, member.id))?.role).toBe("member");
      expect((await findForMember(prisma, id, member.id))?.project.id).toBe(id);
      expect(await findForMember(prisma, id, outsider.id)).toBeNull();
    });

    it("works inside a transaction", async () => {
      const owner = await createSignedInUser(clock);
      const id = await seedProject(owner.id);
      const found = await prisma.$transaction((tx) => findForMember(tx, id, owner.id));
      expect(found?.role).toBe("owner");
    });
  });

  describe("requireOwner", () => {
    it("returns the id for an owner", async () => {
      const owner = await createSignedInUser(clock);
      const id = await seedProject(owner.id);
      expect(await requireOwner(prisma, id, owner.id)).toBe(id);
      expect(await prisma.$transaction((tx) => requireOwner(tx, id, owner.id))).toBe(id);
    });

    it("gives 404 not_found for a bad id, a missing project and a non-member", async () => {
      const owner = await createSignedInUser(clock);
      const outsider = await createSignedInUser(clock);
      const id = await seedProject(owner.id);
      for (const raw of [undefined, "nope", randomUUID()]) {
        const err = await rejection(requireOwner(prisma, raw, owner.id));
        expect([err.status, err.code]).toEqual([404, "not_found"]);
      }
      const err = await rejection(requireOwner(prisma, id, outsider.id));
      expect([err.status, err.code]).toEqual([404, "not_found"]);
    });

    it("gives 403 forbidden for a member", async () => {
      const owner = await createSignedInUser(clock);
      const member = await createSignedInUser(clock);
      const id = await seedProject(owner.id, [member.id]);
      const err = await rejection(requireOwner(prisma, id, member.id));
      expect([err.status, err.code]).toEqual([403, "forbidden"]);
    });
  });

  describe("lockProject", () => {
    it("reports whether the project row exists", async () => {
      const owner = await createSignedInUser(clock);
      const id = await seedProject(owner.id);
      expect(await prisma.$transaction((tx) => lockProject(tx, id))).toBe(true);
      expect(await prisma.$transaction((tx) => lockProject(tx, randomUUID()))).toBe(false);
    });

    it("makes a second lock on the same project wait for the first to commit", async () => {
      const owner = await createSignedInUser(clock);
      const id = await seedProject(owner.id);
      const events: string[] = [];
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let aLocked!: () => void;
      const aHasLock = new Promise<void>((r) => (aLocked = r));

      const txA = prisma.$transaction(
        async (tx) => {
          await lockProject(tx, id);
          events.push("A locked");
          aLocked();
          await released;
          events.push("A committing");
        },
        { timeout: 20_000 },
      );
      await aHasLock;

      const txB = prisma.$transaction(
        async (tx) => {
          await lockProject(tx, id);
          events.push("B locked");
        },
        { timeout: 20_000, maxWait: 20_000 },
      );

      // B must still be blocked after a short bounded wait.
      await new Promise((r) => setTimeout(r, 300));
      expect(events).toEqual(["A locked"]);

      release();
      await txA;
      events.push("A committed");
      await txB;
      // B can only have locked after A's commit released the row.
      expect(events.indexOf("B locked")).toBeGreaterThan(events.indexOf("A committing"));
      expect(events).toContain("B locked");
    }, 30_000);

    it("does not make locks on different projects wait", async () => {
      const owner = await createSignedInUser(clock);
      const idA = await seedProject(owner.id);
      const idB = await seedProject(owner.id);
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let aLocked!: () => void;
      const aHasLock = new Promise<void>((r) => (aLocked = r));

      const txA = prisma.$transaction(
        async (tx) => {
          await lockProject(tx, idA);
          aLocked();
          await released;
        },
        { timeout: 20_000 },
      );
      await aHasLock;

      // Completes while A still holds its lock; if it blocked, this would time out.
      const found = await prisma.$transaction((tx) => lockProject(tx, idB), {
        timeout: 5_000,
        maxWait: 5_000,
      });
      expect(found).toBe(true);

      release();
      await txA;
    }, 30_000);
  });
});
