import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addMember, createSignedInUser, prisma, useTestApp } from "../test/helpers.js";

// Checks the database rules from the ingredients migration itself (spec AC 5, AC 19): the global
// setup has already run `prisma migrate deploy` on the test database, so a broken migration fails the run.
describe("ingredient schema", () => {
  const { clock } = useTestApp();

  async function seed() {
    const t = clock.now();
    const { id: userId } = await createSignedInUser(clock);
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t, descriptionEditedAt: t, currencyEditedAt: t },
    });
    await addMember(project.id, userId, "owner");
    const ingredient = await prisma.ingredient.create({
      data: {
        id: randomUUID(),
        projectId: project.id,
        name: "Bột",
        nameKey: "bột",
        mode: "weight",
        quantity: 380,
        unit: "g",
        price: 24000,
        prices: { create: [{ quantity: 380, unit: "g", price: 24000, authorId: userId }] },
      },
    });
    return { userId, project, ingredient };
  }

  it("removes ingredients and their history with the project", async () => {
    const { project } = await seed();
    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.ingredient.count()).toBe(0);
    expect(await prisma.ingredientPrice.count()).toBe(0);
  });

  it("keeps a history entry, without its author, when the author is deleted", async () => {
    const { userId, ingredient } = await seed();
    await prisma.user.delete({ where: { id: userId } });
    const entries = await prisma.ingredientPrice.findMany({ where: { ingredientId: ingredient.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.authorId).toBeNull();
  });

  it("refuses a second ingredient with the same name key in a project", async () => {
    const { project } = await seed();
    await expect(
      prisma.ingredient.create({
        data: { id: randomUUID(), projectId: project.id, name: "BỘT", nameKey: "bột", mode: "weight", quantity: 1, unit: "g", price: 1 },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("is additive: the migration creates things and drops or alters none of the existing ones", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../prisma/migrations/20261119120000_ingredients/migration.sql", import.meta.url)),
      "utf8",
    );
    expect(sql).not.toMatch(/DROP\s/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
    // The only ALTER TABLEs add foreign keys to the new tables.
    for (const m of sql.matchAll(/ALTER TABLE "(\w+)"/g)) expect(m[1]).toMatch(/^Ingredient/);
  });
});
