import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSignedInUser, prisma, useTestApp } from "../test/helpers.js";

// Checks the database rules from the invites migration itself (spec R37, R38, AC 7 and AC 26).
describe("invite schema", () => {
  const { clock } = useTestApp();

  async function makeProject(ownerId: string) {
    const t = clock.now();
    const project = await prisma.project.create({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Trà sữa",
        currency: "VND",
        nameEditedAt: t,
        descriptionEditedAt: t,
        currencyEditedAt: t,
        members: { create: { userId: ownerId, role: "owner" } },
      },
    });
    return project;
  }

  function makeInvite(projectId: string, extra: { createdById?: string; usedById?: string } = {}) {
    return prisma.invite.create({
      data: {
        projectId,
        codeHash: "a".repeat(64),
        expiresAt: new Date(clock.now().getTime() + 7 * 24 * 3600 * 1000),
        ...extra,
      },
    });
  }

  it("stores an invite as pending, with no use or revoke time", async () => {
    const { id: ownerId } = await createSignedInUser(clock);
    const project = await makeProject(ownerId);

    const invite = await makeInvite(project.id, { createdById: ownerId });

    expect(invite.usedAt).toBeNull();
    expect(invite.revokedAt).toBeNull();
    expect(invite.usedById).toBeNull();
    expect(invite.createdById).toBe(ownerId);
  });

  it("refuses two invites with the same code hash", async () => {
    const { id: ownerId } = await createSignedInUser(clock);
    const project = await makeProject(ownerId);
    await makeInvite(project.id);

    await expect(makeInvite(project.id)).rejects.toThrow();
    expect(await prisma.invite.count()).toBe(1);
  });

  it("removes a project's invites when the project is deleted", async () => {
    const { id: ownerId } = await createSignedInUser(clock);
    const project = await makeProject(ownerId);
    await makeInvite(project.id);

    await prisma.project.delete({ where: { id: project.id } });

    expect(await prisma.invite.count()).toBe(0);
  });

  it("keeps the invite, with the reference cleared, when its creator is deleted", async () => {
    const { id: ownerId } = await createSignedInUser(clock);
    const { id: creatorId } = await createSignedInUser(clock);
    const project = await makeProject(ownerId);
    const invite = await makeInvite(project.id, { createdById: creatorId });

    await prisma.user.delete({ where: { id: creatorId } });

    const after = await prisma.invite.findUnique({ where: { id: invite.id } });
    expect(after).not.toBeNull();
    expect(after?.createdById).toBeNull();
  });

  it("keeps the invite, with the reference cleared, when the user who used it is deleted", async () => {
    const { id: ownerId } = await createSignedInUser(clock);
    const { id: joinerId } = await createSignedInUser(clock);
    const project = await makeProject(ownerId);
    const invite = await makeInvite(project.id, { usedById: joinerId });

    await prisma.user.delete({ where: { id: joinerId } });

    const after = await prisma.invite.findUnique({ where: { id: invite.id } });
    expect(after).not.toBeNull();
    expect(after?.usedById).toBeNull();
  });

  it("leaves an existing project and member unchanged when an invite is added", async () => {
    const { id: ownerId } = await createSignedInUser(clock);
    const project = await makeProject(ownerId);
    const before = {
      project: await prisma.project.findUnique({ where: { id: project.id } }),
      members: await prisma.projectMember.findMany({ where: { projectId: project.id } }),
    };

    await makeInvite(project.id, { createdById: ownerId });

    expect(await prisma.project.findUnique({ where: { id: project.id } })).toEqual(before.project);
    expect(await prisma.projectMember.findMany({ where: { projectId: project.id } })).toEqual(
      before.members,
    );
  });
});

// AC 26: applying the invites migration to a database that already holds projects and members.
describe("invites migration on existing data", () => {
  const migrationsDir = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));

  /** The statements of one trusted migration file; Prisma migrations end every statement with ";" at a line end. */
  function statements(folder: string): string[] {
    const sql = readFileSync(`${migrationsDir}${folder}/migration.sql`, "utf8");
    return sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((part) =>
        part
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((part) => part.length > 0);
  }

  it("keeps existing projects and members unchanged and adds an empty Invite table", async () => {
    const folders = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const upTo = folders.indexOf("20261111032020_projects");
    const invitesAt = folders.indexOf("20261112023324_invites");
    expect(upTo).toBeGreaterThanOrEqual(0);
    expect(invitesAt).toBe(upTo + 1);

    // Generated here, never from input; checked before it goes into SQL.
    const schema = `ac26_${randomBytes(6).toString("hex")}`;
    if (!/^[a-z0-9_]+$/.test(schema)) throw new Error("bad schema name");

    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    try {
      const read = await prisma.$transaction(async (tx) => {
        // SET LOCAL lasts for this transaction on this one connection only.
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        for (const folder of folders.slice(0, upTo + 1)) {
          for (const statement of statements(folder)) await tx.$executeRawUnsafe(statement);
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO "User" ("id","email","passwordHash","displayName","updatedAt")
           VALUES ('u-1','ac26@example.com','x','Owner',TIMESTAMP '2026-01-01 00:00:00'),
                  ('u-2','ac26b@example.com','x','Member',TIMESTAMP '2026-01-01 00:00:00')`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "Project" ("id","name","currency","nameEditedAt","descriptionEditedAt","currencyEditedAt","updatedAt")
           VALUES ('p-1','Trà sữa','VND',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00')`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "ProjectMember" ("projectId","userId","role") VALUES ('p-1','u-1','owner'),('p-1','u-2','member')`,
        );
        const snapshot = async () => ({
          users: await tx.$queryRawUnsafe(`SELECT * FROM "User" ORDER BY "id"`),
          projects: await tx.$queryRawUnsafe(`SELECT * FROM "Project" ORDER BY "id"`),
          members: await tx.$queryRawUnsafe(`SELECT * FROM "ProjectMember" ORDER BY "userId"`),
        });
        const before = await snapshot();

        for (const statement of statements(folders[invitesAt] as string)) {
          await tx.$executeRawUnsafe(statement);
        }

        const after = await snapshot();
        const invites = (await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "Invite"`)) as {
          n: number;
        }[];
        const located = (await tx.$queryRawUnsafe(
          `SELECT table_schema FROM information_schema.tables WHERE table_name = 'Invite' AND table_schema = $1`,
          schema,
        )) as unknown[];
        return { before, after, invites, located };
      });

      expect((read.before.members as unknown[]).length).toBe(2);
      expect((read.before.projects as unknown[]).length).toBe(1);
      expect(read.after).toEqual(read.before);
      expect(read.invites[0]?.n).toBe(0);
      expect(read.located).toHaveLength(1);
    } finally {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
});
