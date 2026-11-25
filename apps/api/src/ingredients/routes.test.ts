import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { MAX_INGREDIENTS_PER_PROJECT } from "./routes.js";

describe("/projects/:projectId/ingredients", () => {
  useTestApp();
  const clock = createClock();
  const app = createApp({ prisma, now: clock.now });

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);

  async function seedProject(currency: "VND" | "USD" = "VND"): Promise<string> {
    const t0 = clock.now();
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency, nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0 },
    });
    return project.id;
  }

  /** a (owner) and b (member) belong to the project; stranger does not. */
  async function world(currency: "VND" | "USD" = "VND") {
    const a = await user();
    const b = await user();
    const stranger = await user();
    const p = await seedProject(currency);
    await addMember(p, a.id, "owner");
    await addMember(p, b.id, "member");
    // Edit times are clamped to server time, so give the tests a past to edit in.
    clock.advanceMs(10_000);
    return { a, b, stranger, p };
  }

  const base = (p: string) => `/projects/${p}/ingredients`;
  const purchase = (over: Record<string, unknown> = {}) => ({ quantity: 380, unit: "g", price: 24000, ...over });
  const body = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    name: "Bột mì",
    mode: "weight",
    purchase: purchase(),
    ...over,
  });
  const create = (u: User, p: string, b: Record<string, unknown> = body()) =>
    request(app).post(base(p)).set(...bearer(u.token)).send(b);
  const patch = (u: User, p: string, id: string, b: Record<string, unknown>) =>
    request(app).patch(`${base(p)}/${id}`).set(...bearer(u.token)).send(b);
  const get = (u: User, p: string) => request(app).get(base(p)).set(...bearer(u.token));
  const del = (u: User, p: string, id: string) => request(app).delete(`${base(p)}/${id}`).set(...bearer(u.token));
  const rows = (id: string) => prisma.ingredientPrice.findMany({ where: { ingredientId: id }, orderBy: { id: "desc" } });

  describe("create (AC 1, 3)", () => {
    it("creates one ingredient in each mode and answers 201 with the saved shape", async () => {
      const { a, p } = await world();
      const cases = [
        { name: "Bột", mode: "weight", purchase: purchase({ quantity: 1500, unit: "kg", price: 50000 }) },
        { name: "Sữa", mode: "volume", purchase: purchase({ quantity: 1000, unit: "l", price: 30000 }) },
        { name: "Bánh", mode: "portion", purchase: purchase({ quantity: 12, unit: "portion", price: 90000 }) },
      ];
      for (const c of cases) {
        const res = await create(a, p, body(c));
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ projectId: p, name: c.name, mode: c.mode, isDefault: false, purchase: c.purchase });
        expect(res.body.prices).toHaveLength(1);
        expect(res.body.prices[0]).toMatchObject({ ...c.purchase, author: { id: a.id } });
        expect(typeof res.body.purchase.quantity).toBe("number");
      }
      expect(((await get(a, p)).body as { ingredients: unknown[] }).ingredients).toHaveLength(3);
    });

    it("trims the name and accepts the default flag and 3 decimals", async () => {
      const { a, p } = await world();
      const res = await create(a, p, body({ name: "  Muối  ", isDefault: true, purchase: purchase({ quantity: 0.001 }) }));
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Muối");
      expect(res.body.isDefault).toBe(true);
      expect(res.body.purchase.quantity).toBe(0.001);
    });

    it.each([
      ["empty name", { name: "   " }],
      ["61-character name", { name: "x".repeat(61) }],
      ["quantity 0", { purchase: purchase({ quantity: 0 }) }],
      ["negative quantity", { purchase: purchase({ quantity: -1 }) }],
      ["4 decimals", { purchase: purchase({ quantity: 1.0001 }) }],
      ["quantity above the maximum", { purchase: purchase({ quantity: 1_000_000.001 }) }],
      ["negative price", { purchase: purchase({ price: -1 }) }],
      ["fractional price", { purchase: purchase({ price: 10.5 }) }],
      ["price above the VND maximum", { purchase: purchase({ price: 1_000_000_001 }) }],
      ["unknown mode", { mode: "solid" }],
      ["unknown unit", { purchase: purchase({ unit: "lb" }) }],
      ["unit that does not fit the mode", { mode: "volume", purchase: purchase({ unit: "g" }) }],
      ["unknown field", { extra: 1 }],
      ["bad id", { id: "nope" }],
    ])("refuses %s", async (_label, over) => {
      const { a, p } = await world();
      expectError(await create(a, p, body(over)), 400, "validation_failed");
      expect(await prisma.ingredient.count()).toBe(0);
    });

    it("accepts the maximum price and quantity", async () => {
      const { a, p } = await world();
      const res = await create(a, p, body({ purchase: purchase({ quantity: 1_000_000, price: 1_000_000_000 }) }));
      expect(res.status).toBe(201);
    });

    it("applies the USD maximum in cents", async () => {
      const { a, p } = await world("USD");
      expect((await create(a, p, body({ purchase: purchase({ price: 10_000_000 }) }))).status).toBe(201);
      expectError(
        await create(a, p, body({ name: "Other", purchase: purchase({ price: 10_000_001 }) })),
        400,
        "validation_failed",
      );
    });

    it("refuses a duplicate name ignoring case, with 409 ingredient_name_taken", async () => {
      const { a, b, p } = await world();
      expect((await create(a, p, body({ name: "Đường" }))).status).toBe(201);
      expectError(await create(b, p, body({ name: " đƯỜNG " })), 409, "ingredient_name_taken");
      // Another project may reuse the name.
      const other = await seedProject();
      await addMember(other, a.id, "owner");
      expect((await create(a, other, body({ name: "Đường" }))).status).toBe(201);
    });
  });

  describe("limit (AC 6)", () => {
    it("refuses the 301st with ingredient_limit_reached", async () => {
      const { a, p } = await world();
      const t = clock.now();
      await prisma.ingredient.createMany({
        data: Array.from({ length: MAX_INGREDIENTS_PER_PROJECT }, (_, i) => ({
          id: randomUUID(),
          projectId: p,
          name: `N${i}`,
          nameKey: `n${i}`,
          mode: "weight" as const,
          quantity: 1,
          unit: "g",
          price: 1,
          nameEditedAt: t,
          modeEditedAt: t,
          purchaseEditedAt: t,
          defaultEditedAt: t,
        })),
      });
      expectError(await create(a, p, body({ name: "One more" })), 409, "ingredient_limit_reached");
      expect(await prisma.ingredient.count()).toBe(MAX_INGREDIENTS_PER_PROJECT);
    });
  });

  describe("members and delete (AC 5)", () => {
    it("lets another member edit and delete, and the project delete removes everything", async () => {
      const { a, b, p } = await world();
      const id = randomUUID();
      expect((await create(a, p, body({ id }))).status).toBe(201);

      const edited = await patch(b, p, id, { name: { value: "Bột mì số 8", editedAt: iso(-1000) } });
      expect(edited.status).toBe(200);
      expect(edited.body.name).toBe("Bột mì số 8");

      expect((await del(b, p, id)).status).toBe(204);
      expect(await prisma.ingredient.count()).toBe(0);
      expect(await rows(id)).toHaveLength(0);

      const id2 = randomUUID();
      await create(a, p, body({ id: id2, name: "Khác" }));
      await patch(a, p, id2, { purchase: { value: purchase({ price: 1 }), editedAt: iso(-500) } });
      expect(await rows(id2)).toHaveLength(2);
      await prisma.project.delete({ where: { id: p } });
      expect(await prisma.ingredient.count()).toBe(0);
      expect(await prisma.ingredientPrice.count()).toBe(0);
    });

    it("sends a done draft that used the deleted ingredient back to working, and leaves converted ones alone", async () => {
      const { a, p } = await world();
      const id = randomUUID();
      await create(a, p, body({ id }));
      const t = clock.now();
      const mk = (name: string, status: "working" | "done", converted: boolean) =>
        prisma.draft.create({
          data: {
            id: randomUUID(), projectId: p, name, sizes: ["M"], status, statusEditedAt: new Date(0),
            ...(converted ? { convertedAt: t } : {}),
            lines: {
              create: [
                { id: randomUUID(), kind: "existing", ingredientId: id, amount: 10, position: 1 },
                { id: randomUUID(), kind: "new", newName: `X ${name}`, newNameKey: `x ${name}`, newKind: "weight", purchaseQty: 1, purchasePrice: 1, amount: 5, position: 2 },
              ],
            },
          },
        });
      const done = await mk("done", "done", false);
      const working = await mk("working", "working", false);
      const converted = await mk("converted", "done", true);
      clock.advanceMs(5000);
      expect((await del(a, p, id)).status).toBe(204);
      const status = async (d: string) => (await prisma.draft.findUniqueOrThrow({ where: { id: d } }));
      const reopened = await status(done.id);
      expect(reopened.status).toBe("working");
      expect(reopened.statusEditedAt.getTime()).toBe(clock.now().getTime());
      expect((await status(working.id)).status).toBe("working");
      expect((await status(converted.id)).status).toBe("done");
    });

    it("answers 404 when deleting an ingredient that is already gone", async () => {
      const { a, p } = await world();
      expect((await del(a, p, randomUUID())).status).toBe(404);
    });
  });

  describe("price history (AC 7, 8)", () => {
    it("records one entry on create, one per changed price, none for a rename", async () => {
      const { a, b, p } = await world();
      const id = randomUUID();
      await create(a, p, body({ id }));
      expect(await rows(id)).toHaveLength(1);

      const priced = await patch(b, p, id, { purchase: { value: purchase({ price: 26000 }), editedAt: iso(-3000) } });
      expect(priced.body.purchase).toEqual(purchase({ price: 26000 }));
      expect(await rows(id)).toHaveLength(2);
      expect(priced.body.prices[0]).toMatchObject({ price: 26000, author: { id: b.id } });

      const renamed = await patch(a, p, id, {
        name: { value: "Bột mì mới", editedAt: iso(-2000) },
        mode: { value: "weight", editedAt: iso(-2000) },
        isDefault: { value: true, editedAt: iso(-2000) },
      });
      expect(renamed.body).toMatchObject({ name: "Bột mì mới", isDefault: true });
      expect(await rows(id)).toHaveLength(2);
    });

    it("keeps only the latest 5 entries, newest first, after 7 purchase changes", async () => {
      const { a, p } = await world();
      const id = randomUUID();
      await create(a, p, body({ id, purchase: purchase({ price: 1000 }) }));
      for (let i = 1; i <= 6; i += 1) {
        clock.advanceMs(1000);
        const res = await patch(a, p, id, { purchase: { value: purchase({ price: 1000 + i }), editedAt: iso(-1) } });
        expect(res.status).toBe(200);
      }
      const stored = await rows(id);
      expect(stored.map((r) => r.price)).toEqual([1006, 1005, 1004, 1003, 1002]);
      const item = (await get(a, p)).body.ingredients[0];
      expect(item.prices.map((x: { price: number }) => x.price)).toEqual([1006, 1005, 1004, 1003, 1002]);
      expect(item.purchase.price).toBe(1006);
    });

    it("adds no entry when only the display unit changes", async () => {
      const { a, p } = await world();
      const id = randomUUID();
      await create(a, p, body({ id, purchase: purchase({ quantity: 1000, unit: "g" }) }));
      const res = await patch(a, p, id, {
        purchase: { value: purchase({ quantity: 1000, unit: "kg" }), editedAt: iso(-1) },
      });
      expect(res.body.purchase.unit).toBe("kg");
      expect(await rows(id)).toHaveLength(1);
    });
  });

  describe("sync (AC 9)", () => {
    it("lets an older edit lose per field and a stale purchase add no history entry", async () => {
      const { a, b, p } = await world();
      const id = randomUUID();
      await create(a, p, body({ id }));

      await patch(a, p, id, {
        name: { value: "Newer", editedAt: iso(-1000) },
        purchase: { value: purchase({ price: 30000 }), editedAt: iso(-1000) },
      });
      const stale = await patch(b, p, id, {
        name: { value: "Older", editedAt: iso(-5000) },
        purchase: { value: purchase({ price: 99 }), editedAt: iso(-5000) },
        isDefault: { value: true, editedAt: iso(-5000) },
      });
      expect(stale.status).toBe(200);
      expect(stale.body.name).toBe("Newer");
      expect(stale.body.purchase.price).toBe(30000);
      // Nothing newer touched the default flag, so the older edit still wins that one field.
      expect(stale.body.isDefault).toBe(true);
      expect(await rows(id)).toHaveLength(2);
    });

    it("clamps an edit time in the future so it cannot win every conflict", async () => {
      const { a, b, p } = await world();
      const id = randomUUID();
      await create(a, p, body({ id }));
      await patch(a, p, id, { name: { value: "Future", editedAt: iso(10 * 86_400_000) } });
      clock.advanceMs(1000);
      const res = await patch(b, p, id, { name: { value: "Later", editedAt: iso(0) } });
      expect(res.body.name).toBe("Later");
    });

    it("creates one ingredient when the same id is sent twice", async () => {
      const { a, b, p } = await world();
      const id = randomUUID();
      const first = await create(a, p, body({ id }));
      const second = await create(b, p, body({ id, name: "Different", purchase: purchase({ price: 1 }) }));
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.name).toBe("Bột mì");
      expect(await prisma.ingredient.count()).toBe(1);
      expect(await rows(id)).toHaveLength(1);
    });

    it("answers 409 id_conflict when the id belongs to another project", async () => {
      const { a, p } = await world();
      const other = await seedProject();
      await addMember(other, a.id, "owner");
      const id = randomUUID();
      await create(a, other, body({ id }));
      expectError(await create(a, p, body({ id })), 409, "id_conflict");
    });

    it("refuses a rename to a name another ingredient has", async () => {
      const { a, p } = await world();
      const one = randomUUID();
      const two = randomUUID();
      await create(a, p, body({ id: one, name: "Một" }));
      await create(a, p, body({ id: two, name: "Hai" }));
      expectError(await patch(a, p, two, { name: { value: "MỘT", editedAt: iso(-1000) } }), 409, "ingredient_name_taken");
      const names = (await get(a, p)).body.ingredients.map((i: { name: string }) => i.name).sort();
      expect(names).toEqual(["Hai", "Một"]);
    });

    it("rolls back with 409 ingredient_mode_conflict when only the newer mode wins and the unit no longer fits", async () => {
      const { a, p } = await world();
      const id = randomUUID();
      await create(a, p, body({ id }));
      // The purchase was edited at t2 by another phone; this older edit changes mode and purchase at t1.
      await prisma.ingredient.update({ where: { id }, data: { purchaseEditedAt: new Date(clock.now().getTime() - 1000) } });
      const res = await patch(a, p, id, {
        mode: { value: "volume", editedAt: iso(-5000) },
        purchase: { value: purchase({ quantity: 1, unit: "l" }), editedAt: iso(-5000) },
        name: { value: "Renamed", editedAt: iso(-5000) },
      });
      expectError(res, 409, "ingredient_mode_conflict");
      const row = await prisma.ingredient.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ mode: "weight", unit: "g", name: "Bột mì" });
      expect(await rows(id)).toHaveLength(1);
    });

    it("rolls back with 409 ingredient_mode_conflict when only the newer purchase wins and the mode no longer fits", async () => {
      const { a, p } = await world();
      const id = randomUUID();
      await create(a, p, body({ id }));
      // The mode was edited at t2 by another phone; this older edit changes mode and purchase at t1.
      await prisma.ingredient.update({ where: { id }, data: { modeEditedAt: new Date(clock.now().getTime() - 1000) } });
      const res = await patch(a, p, id, {
        mode: { value: "volume", editedAt: iso(-5000) },
        purchase: { value: purchase({ quantity: 1, unit: "l" }), editedAt: iso(-5000) },
      });
      expectError(res, 409, "ingredient_mode_conflict");
      const row = await prisma.ingredient.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ mode: "weight", unit: "g" });
      expect(await rows(id)).toHaveLength(1);
    });

    it("refuses bad patches: empty, unknown field, unit not fitting the mode, price over the maximum", async () => {
      const { a, p } = await world();
      const id = randomUUID();
      await create(a, p, body({ id }));
      const at = iso(-1000);
      expectError(await patch(a, p, id, {}), 400, "validation_failed");
      expectError(await patch(a, p, id, { nope: { value: 1, editedAt: at } }), 400, "validation_failed");
      expectError(
        await patch(a, p, id, { purchase: { value: purchase({ unit: "ml" }), editedAt: at } }),
        400,
        "validation_failed",
      );
      expectError(await patch(a, p, id, { mode: { value: "volume", editedAt: at } }), 400, "validation_failed");
      expectError(
        await patch(a, p, id, { purchase: { value: purchase({ price: 2_000_000_000 }), editedAt: at } }),
        400,
        "validation_failed",
      );
      // Mode and purchase together may change the mode.
      const ok = await patch(a, p, id, {
        mode: { value: "volume", editedAt: at },
        purchase: { value: purchase({ unit: "ml" }), editedAt: at },
      });
      expect(ok.status).toBe(200);
      expect(ok.body.mode).toBe("volume");
      expect(await rows(id)).toHaveLength(1);
    });

    it("answers 404 to a non-member everywhere and 401 when signed out", async () => {
      const { a, stranger, p } = await world();
      const id = randomUUID();
      await create(a, p, body({ id }));
      expect((await get(stranger, p)).status).toBe(404);
      expect((await create(stranger, p)).status).toBe(404);
      expect((await patch(stranger, p, id, { name: { value: "X", editedAt: iso(-1) } })).status).toBe(404);
      expect((await del(stranger, p, id)).status).toBe(404);
      expect((await request(app).get(`${base(p)}/${id}`).set(...bearer(stranger.token))).status).toBe(404);
      expect((await get(a, randomUUID())).status).toBe(404);
      expect((await request(app).get(`${base(p)}/${id}`).set(...bearer(a.token))).status).toBe(200);

      expect((await request(app).get(base(p))).status).toBe(401);
      expect((await request(app).post(base(p)).send(body())).status).toBe(401);
      expect((await request(app).patch(`${base(p)}/${id}`).send({})).status).toBe(401);
      expect((await request(app).delete(`${base(p)}/${id}`)).status).toBe(401);
      expect(await prisma.ingredient.count()).toBe(1);
    });
  });
});
