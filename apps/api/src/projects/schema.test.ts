import { describe, expect, it } from "vitest";
import { createSignedInUser, prisma, useTestApp } from "../test/helpers.js";

// Checks the database rules from the projects migration itself (spec AC 2 and AC 34),
// so removing the composite key or a cascade makes these fail.
describe("project schema", () => {
  const { clock } = useTestApp();

  async function makeProject(id: string) {
    const t = clock.now();
    return prisma.project.create({
      data: {
        id,
        name: "Trà sữa",
        currency: "VND",
        nameEditedAt: t,
        descriptionEditedAt: t,
        currencyEditedAt: t,
      },
    });
  }

  async function makeMembership() {
    const { id: userId } = await createSignedInUser(clock);
    const project = await makeProject("11111111-1111-4111-8111-111111111111");
    await prisma.projectMember.create({
      data: { projectId: project.id, userId, role: "owner" },
    });
    return { userId, projectId: project.id };
  }

  it("refuses the same person twice in one project", async () => {
    const { userId, projectId } = await makeMembership();

    await expect(
      prisma.projectMember.create({ data: { projectId, userId, role: "member" } }),
    ).rejects.toThrow();
    expect(await prisma.projectMember.count()).toBe(1);
  });

  it("removes a user's memberships when the user is deleted", async () => {
    const { userId, projectId } = await makeMembership();

    await prisma.user.delete({ where: { id: userId } });

    expect(await prisma.projectMember.count()).toBe(0);
    // The project itself stays; only the membership goes.
    expect(await prisma.project.findUnique({ where: { id: projectId } })).not.toBeNull();
  });

  it("removes a project's memberships when the project is deleted", async () => {
    const { userId, projectId } = await makeMembership();

    await prisma.project.delete({ where: { id: projectId } });

    expect(await prisma.projectMember.count()).toBe(0);
    // The user stays; only the membership goes.
    expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
  });
});
