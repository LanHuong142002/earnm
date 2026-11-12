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
