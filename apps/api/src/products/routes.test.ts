import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { MAX_PRODUCTS_PER_PROJECT } from "./routes.js";

describe("/projects/:projectId/products", () => {
  useTestApp();
  const clock = createClock();
  const app = createApp({ prisma, now: clock.now });

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  /** A time after every earlier edit; edit times are clamped to server time, so the clock moves first. */
  const later = () => {
    clock.advanceMs(1000);
    return iso();
  };
  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);

  async function seedProject(currency: "VND" | "USD" = "VND"): Promise<string> {
    const t0 = clock.now();
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency, nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0, targetMarginEditedAt: new Date(0) },
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

  async function ingredient(
    p: string,
    name: string,
    over: { mode?: "weight" | "volume" | "portion"; isDefault?: boolean } = {},
  ) {
    const row = await prisma.ingredient.create({
      data: {
        id: randomUUID(),
        projectId: p,
        name,
        nameKey: name.toLowerCase(),
        mode: over.mode ?? "weight",
        quantity: 1000,
        unit: over.mode === "portion" ? "portion" : "g",
        price: 10000,
        isDefault: over.isDefault ?? false,
      },
    });
    return row.id;
  }

  async function extraCost(p: string, name: string, amount: number, isDefault: boolean) {
    const row = await prisma.extraCost.create({ data: { id: randomUUID(), projectId: p, name, amount, isDefault } });
    return row.id;
  }

  const base = (p: string) => `/projects/${p}/products`;
  const body = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), name: "Trà đào", sizes: ["M"], ...over });
  const create = (u: User, p: string, b: Record<string, unknown> = body()) =>
    request(app).post(base(p)).set(...bearer(u.token)).send(b);
  const patch = (u: User, p: string, id: string, b: Record<string, unknown>) =>
    request(app).patch(`${base(p)}/${id}`).set(...bearer(u.token)).send(b);
  const get = (u: User, p: string) => request(app).get(base(p)).set(...bearer(u.token));
  const getOne = (u: User, p: string, id: string) => request(app).get(`${base(p)}/${id}`).set(...bearer(u.token));
  const del = (u: User, p: string, id: string) => request(app).delete(`${base(p)}/${id}`).set(...bearer(u.token));
  const setPrice = (u: User, p: string, id: string, size: string, b: Record<string, unknown>) =>
    request(app).patch(`${base(p)}/${id}/sizes/${size}/price`).set(...bearer(u.token)).send(b);
  const setLines = (u: User, p: string, id: string, size: string, b: Record<string, unknown>) =>
    request(app).patch(`${base(p)}/${id}/sizes/${size}/lines`).set(...bearer(u.token)).send(b);

  type SizeBody = {
    size: string;
    sellingPrice: number | null;
    lines: { ingredientId: string; amount: number; included: boolean; isDefault: boolean }[];
    extras: { id: string; name: string; amount: number; included: boolean; isDefault: boolean; extraCostId: string | null }[];
  };
  const sizeOf = (res: { body: { sizes: SizeBody[] } }, size: string) => res.body.sizes.find((s) => s.size === size)!;

  describe("create, rename, sizes, delete (AC 1)", () => {
    it("creates a product with sizes in S, M, L order and answers 201", async () => {
      const { a, p } = await world();
      const res = await create(a, p, body({ name: "  Trà đào  ", sizes: ["L", "S"] }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ projectId: p, name: "Trà đào" });
      expect(res.body.sizes.map((s: SizeBody) => s.size)).toEqual(["S", "L"]);
      expect(res.body.sizes[0]).toMatchObject({ sellingPrice: null, lines: [], extras: [] });
      expect(((await get(a, p)).body as { products: unknown[] }).products).toHaveLength(1);
      expect((await getOne(a, p, res.body.id)).body.id).toBe(res.body.id);
    });

    it("refuses an empty or blank name, no sizes, repeated sizes, an unknown size and extra keys", async () => {
      const { a, p } = await world();
      for (const bad of [
        { name: "" },
        { name: "   " },
        { name: "x".repeat(61) },
        { sizes: [] },
        { sizes: ["S", "S"] },
        { sizes: ["XL"] },
        { sizes: undefined },
        { extra: 1 },
      ]) {
        const res = await create(a, p, body(bad));
        expectError(res, 400, "validation_failed");
      }
      expect(await prisma.product.count()).toBe(0);
    });

    it("refuses a duplicate name ignoring case with product_name_taken", async () => {
      const { a, b, p } = await world();
      expect((await create(a, p, body({ name: "Trà Đào" }))).status).toBe(201);
      expectError(await create(b, p, body({ name: "  trà đào " })), 409, "product_name_taken");
      // Another project may reuse the name.
      const other = await seedProject();
      await addMember(other, a.id, "owner");
      expect((await create(a, other, body({ name: "Trà đào" }))).status).toBe(201);
    });

    it("renames, and refuses a rename onto another product's name", async () => {
      const { a, p } = await world();
      const one = (await create(a, p, body({ name: "One" }))).body;
      await create(a, p, body({ name: "Two" }));
      const res = await patch(a, p, one.id, { name: { value: "Uno", editedAt: iso() } });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Uno");
      expectError(await patch(a, p, one.id, { name: { value: "two", editedAt: later() } }), 409, "product_name_taken");
    });

    it("adds and removes sizes, and refuses to remove the last one", async () => {
      const { a, p } = await world();
      const prod = (await create(a, p, body({ sizes: ["M"] }))).body;
      let res = await patch(a, p, prod.id, { sizes: { value: ["S", "M", "L"], editedAt: iso() } });
      expect(res.body.sizes.map((s: SizeBody) => s.size)).toEqual(["S", "M", "L"]);
      res = await patch(a, p, prod.id, { sizes: { value: ["L"], editedAt: later() } });
      expect(res.body.sizes.map((s: SizeBody) => s.size)).toEqual(["L"]);
      expect(await prisma.productSizeRow.count({ where: { productId: prod.id } })).toBe(1);
      expectError(await patch(a, p, prod.id, { sizes: { value: [], editedAt: later() } }), 400, "validation_failed");
      expect((await getOne(a, p, prod.id)).body.sizes).toHaveLength(1);
    });

    it("rejects an empty patch and unknown fields", async () => {
      const { a, p } = await world();
      const prod = (await create(a, p)).body;
      expectError(await patch(a, p, prod.id, {}), 400, "validation_failed");
      expectError(await patch(a, p, prod.id, { nope: { value: 1, editedAt: iso() } }), 400, "validation_failed");
    });

    it("deletes the product with its sizes and lines but keeps the ingredients", async () => {
      const { a, p } = await world();
      const ing = await ingredient(p, "Đường", { isDefault: true });
      const prod = (await create(a, p, body({ sizes: ["S", "M"] }))).body;
      expect(await prisma.recipeLine.count()).toBe(2);
      expect((await del(a, p, prod.id)).status).toBe(204);
      expect(await prisma.product.count()).toBe(0);
      expect(await prisma.productSizeRow.count()).toBe(0);
      expect(await prisma.recipeLine.count()).toBe(0);
      expect(await prisma.ingredient.findUnique({ where: { id: ing } })).not.toBeNull();
      expectError(await del(a, p, prod.id), 404, "not_found");
    });
  });

  describe("limit (AC 2)", () => {
    it("refuses the 201st product with product_limit_reached", async () => {
      const { a, p } = await world();
      await prisma.product.createMany({
        data: Array.from({ length: MAX_PRODUCTS_PER_PROJECT }, (_, i) => ({
          id: randomUUID(),
          projectId: p,
          name: `P${i}`,
          nameKey: `p${i}`,
        })),
      });
      expectError(await create(a, p, body({ name: "One more" })), 409, "product_limit_reached");
      expect(await prisma.product.count()).toBe(MAX_PRODUCTS_PER_PROJECT);
    });
  });

  describe("selling price (AC 3)", () => {
    it("stores an integer price, and null clears it", async () => {
      const { a, p } = await world();
      const prod = (await create(a, p)).body;
      const res = await setPrice(a, p, prod.id, "M", { value: 35000, editedAt: iso() });
      expect(res.status).toBe(200);
      expect(sizeOf(res, "M").sellingPrice).toBe(35000);
      expect(Number.isInteger(sizeOf(res, "M").sellingPrice)).toBe(true);
      const cleared = await setPrice(a, p, prod.id, "M", { value: null, editedAt: later() });
      expect(sizeOf(cleared, "M").sellingPrice).toBeNull();
      // PUT does the same as PATCH.
      const put = await request(app)
        .put(`${base(p)}/${prod.id}/sizes/M/price`)
        .set(...bearer(a.token))
        .send({ value: 40000, editedAt: later() });
      expect(sizeOf(put, "M").sellingPrice).toBe(40000);
    });

    it("refuses prices out of range for the currency, fractions and negatives", async () => {
      const { a, p } = await world("VND");
      const prod = (await create(a, p)).body;
      for (const value of [-1, 1_000_000_001, 100.5, "5000"]) {
        expectError(await setPrice(a, p, prod.id, "M", { value, editedAt: iso() }), 400, "validation_failed");
      }
      expect((await setPrice(a, p, prod.id, "M", { value: 1_000_000_000, editedAt: iso() })).status).toBe(200);

      const usd = await world("USD");
      const prodUsd = (await create(usd.a, usd.p)).body;
      expectError(await setPrice(usd.a, usd.p, prodUsd.id, "M", { value: 10_000_001, editedAt: iso() }), 400, "validation_failed");
      expect((await setPrice(usd.a, usd.p, prodUsd.id, "M", { value: 10_000_000, editedAt: iso() })).status).toBe(200);
    });

    it("404s a size the product doesn't have", async () => {
      const { a, p } = await world();
      const prod = (await create(a, p)).body;
      expectError(await setPrice(a, p, prod.id, "L", { value: 1, editedAt: iso() }), 404, "not_found");
      expectError(await setPrice(a, p, prod.id, "XL", { value: 1, editedAt: iso() }), 404, "not_found");
    });
  });

  describe("recipe lines (AC 4, 5)", () => {
    it("gives a new size a ticked line per default ingredient: portion 1, others 0", async () => {
      const { a, p } = await world();
      const flour = await ingredient(p, "Bột", { isDefault: true });
      const milk = await ingredient(p, "Sữa", { mode: "volume", isDefault: true });
      const cake = await ingredient(p, "Bánh", { mode: "portion", isDefault: true });
      await ingredient(p, "Không mặc định");
      const res = await create(a, p, body({ sizes: ["S", "L"] }));
      for (const size of ["S", "L"]) {
        const lines = sizeOf(res, size).lines;
        expect(lines).toHaveLength(3);
        expect(Object.fromEntries(lines.map((l) => [l.ingredientId, l.amount]))).toEqual({
          [flour]: 0,
          [milk]: 0,
          [cake]: 1,
        });
        expect(lines.every((l) => l.included && l.isDefault)).toBe(true);
      }
    });

    it("gives a size added later the defaults too", async () => {
      const { a, p } = await world();
      const ing = await ingredient(p, "Bột", { isDefault: true });
      const prod = (await create(a, p, body({ sizes: ["M"] }))).body;
      const res = await patch(a, p, prod.id, { sizes: { value: ["M", "L"], editedAt: iso() } });
      expect(sizeOf(res, "L").lines).toEqual([{ ingredientId: ing, amount: 0, included: true, isDefault: true }]);
    });

    it("replaces the lines: add a line, set amounts, untick a default", async () => {
      const { a, p } = await world();
      const sugar = await ingredient(p, "Đường", { isDefault: true });
      const tea = await ingredient(p, "Trà");
      const prod = (await create(a, p)).body;
      const res = await setLines(a, p, prod.id, "M", {
        value: {
          lines: [
            { ingredientId: sugar, amount: 12.5, included: false },
            { ingredientId: tea, amount: 4, included: true },
          ],
          extras: [],
        },
        editedAt: iso(),
      });
      expect(res.status).toBe(200);
      expect(sizeOf(res, "M").lines).toEqual([
        { ingredientId: sugar, amount: 12.5, included: false, isDefault: true },
        { ingredientId: tea, amount: 4, included: true, isDefault: false },
      ]);
      expect(typeof sizeOf(res, "M").lines[0]!.amount).toBe("number");
    });

    it("refuses removing a default line", async () => {
      const { a, p } = await world();
      const sugar = await ingredient(p, "Đường", { isDefault: true });
      const tea = await ingredient(p, "Trà");
      const prod = (await create(a, p)).body;
      const res = await setLines(a, p, prod.id, "M", {
        value: { lines: [{ ingredientId: tea, amount: 1, included: true }], extras: [] },
        editedAt: iso(),
      });
      expectError(res, 400, "validation_failed");
      expect(sizeOf(await getOne(a, p, prod.id), "M").lines.map((l) => l.ingredientId)).toEqual([sugar]);
    });

    it("refuses a foreign ingredient, a duplicate ingredient and amount 0 on a non-default line", async () => {
      const { a, p } = await world();
      const tea = await ingredient(p, "Trà");
      const other = await seedProject();
      const foreign = await ingredient(other, "Của nhà khác");
      const prod = (await create(a, p)).body;
      const send = (lines: unknown[]) =>
        setLines(a, p, prod.id, "M", { value: { lines, extras: [] }, editedAt: iso() });
      expectError(await send([{ ingredientId: foreign, amount: 1, included: true }]), 400, "validation_failed");
      expectError(await send([{ ingredientId: randomUUID(), amount: 1, included: true }]), 400, "validation_failed");
      expectError(
        await send([
          { ingredientId: tea, amount: 1, included: true },
          { ingredientId: tea, amount: 2, included: true },
        ]),
        400,
        "validation_failed",
      );
      expectError(await send([{ ingredientId: tea, amount: 0, included: true }]), 400, "validation_failed");
      expectError(await send([{ ingredientId: tea, amount: -1, included: true }]), 400, "validation_failed");
      expectError(await send([{ ingredientId: tea, amount: 100_000.001, included: true }]), 400, "validation_failed");
      expectError(await send([{ ingredientId: tea, amount: 1.2345, included: true }]), 400, "validation_failed");
      expect(sizeOf(await getOne(a, p, prod.id), "M").lines).toEqual([]);
      // The largest amount and 3 decimals are fine.
      expect((await send([{ ingredientId: tea, amount: 100_000, included: true }])).status).toBe(200);
      expect((await send([{ ingredientId: tea, amount: 0.125, included: true }])).status).toBe(200);
    });

    it("lets a default line keep amount 0", async () => {
      const { a, p } = await world();
      const sugar = await ingredient(p, "Đường", { isDefault: true });
      const prod = (await create(a, p)).body;
      const res = await setLines(a, p, prod.id, "M", {
        value: { lines: [{ ingredientId: sugar, amount: 0, included: true }], extras: [] },
        editedAt: iso(),
      });
      expect(res.status).toBe(200);
    });

    it("marking an ingredient default later does not touch existing sizes (AC 7)", async () => {
      const { a, p } = await world();
      const prod = (await create(a, p, body({ sizes: ["S", "M"] }))).body;
      const ing = await ingredient(p, "Mới");
      await prisma.ingredient.update({ where: { id: ing }, data: { isDefault: true } });
      const res = await getOne(a, p, prod.id);
      expect(sizeOf(res, "S").lines).toEqual([]);
      expect(sizeOf(res, "M").lines).toEqual([]);
      // ...but a size created afterwards gets it.
      const later = await patch(a, p, prod.id, { sizes: { value: ["S", "M", "L"], editedAt: iso() } });
      expect(sizeOf(later, "L").lines.map((l) => l.ingredientId)).toEqual([ing]);
      expect(sizeOf(later, "S").lines).toEqual([]);
    });
  });

  describe("extra costs on a size (AC 6)", () => {
    it("copies default extra costs into a new size, ticked", async () => {
      const { a, p } = await world();
      const ice = await extraCost(p, "Đá", 500, true);
      await extraCost(p, "Ly", 1500, false);
      const res = await create(a, p, body({ sizes: ["M", "L"] }));
      for (const size of ["M", "L"]) {
        expect(sizeOf(res, size).extras).toEqual([
          { id: expect.any(String), name: "Đá", amount: 500, included: true, isDefault: true, extraCostId: ice },
        ]);
      }
    });

    it("changing or deleting the project extra cost leaves the size unchanged", async () => {
      const { a, p } = await world();
      const ice = await extraCost(p, "Đá", 500, true);
      const prod = (await create(a, p)).body;
      await prisma.extraCost.update({ where: { id: ice }, data: { name: "Nước đá", amount: 900 } });
      let res = await getOne(a, p, prod.id);
      expect(sizeOf(res, "M").extras[0]).toMatchObject({ name: "Đá", amount: 500, extraCostId: ice });
      await prisma.extraCost.delete({ where: { id: ice } });
      res = await getOne(a, p, prod.id);
      expect(sizeOf(res, "M").extras[0]).toMatchObject({ name: "Đá", amount: 500, extraCostId: null });
    });

    it("replaces extras: untick, change the amount, add one from the list or free", async () => {
      const { a, p } = await world();
      await extraCost(p, "Đá", 500, true);
      const lid = await extraCost(p, "Nắp", 700, false);
      const prod = (await create(a, p)).body;
      const ice = sizeOf(await getOne(a, p, prod.id), "M").extras[0]!;
      const res = await setLines(a, p, prod.id, "M", {
        value: {
          lines: [],
          extras: [
            { id: ice.id, name: "Đá", amount: 800, included: false, isDefault: true, extraCostId: ice.extraCostId },
            { name: "Nắp", amount: 700, included: true, isDefault: false, extraCostId: lid },
            { name: "Khác", amount: 100, included: true, isDefault: false },
          ],
        },
        editedAt: iso(),
      });
      expect(res.status).toBe(200);
      const extras = sizeOf(res, "M").extras;
      expect(extras.map((e) => [e.name, e.amount, e.included, e.extraCostId])).toEqual([
        ["Đá", 800, false, ice.extraCostId],
        ["Nắp", 700, true, lid],
        ["Khác", 100, true, null],
      ]);
      expect(extras[0]!.id).toBe(ice.id);
    });

    it("refuses bad extras and drops a link to an unknown extra cost", async () => {
      const { a, p } = await world("VND");
      const prod = (await create(a, p)).body;
      const send = (extras: unknown[]) =>
        setLines(a, p, prod.id, "M", { value: { lines: [], extras }, editedAt: iso() });
      const ok = { name: "Đá", amount: 500, included: true, isDefault: false };
      expectError(await send([{ ...ok, name: "" }]), 400, "validation_failed");
      expectError(await send([{ ...ok, name: "x".repeat(41) }]), 400, "validation_failed");
      expectError(await send([{ ...ok, amount: -1 }]), 400, "validation_failed");
      expectError(await send([{ ...ok, amount: 1_000_000_001 }]), 400, "validation_failed");
      const id = randomUUID();
      expectError(await send([{ ...ok, id }, { ...ok, id }]), 400, "validation_failed");
      const res = await send([{ ...ok, extraCostId: randomUUID() }]);
      expect(res.status).toBe(200);
      expect(sizeOf(res, "M").extras[0]!.extraCostId).toBeNull();
    });
  });

  describe("ingredient in use (AC 8)", () => {
    it("refuses to delete an ingredient used in a recipe, naming the products", async () => {
      const { a, p } = await world();
      const ing = await ingredient(p, "Đường", { isDefault: true });
      await create(a, p, body({ name: "Zebra", sizes: ["S", "M"] }));
      await create(a, p, body({ name: "Alpha" }));
      const res = await request(app).delete(`/projects/${p}/ingredients/${ing}`).set(...bearer(a.token));
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: "ingredient_in_use",
          message: expect.any(String),
          details: { products: ["Alpha", "Zebra"] },
        },
      });
      expect(await prisma.ingredient.findUnique({ where: { id: ing } })).not.toBeNull();
    });

    it("deletes it once no recipe uses it", async () => {
      const { a, p } = await world();
      const ing = await ingredient(p, "Đường", { isDefault: true });
      const prod = (await create(a, p)).body;
      await del(a, p, prod.id);
      const res = await request(app).delete(`/projects/${p}/ingredients/${ing}`).set(...bearer(a.token));
      expect(res.status).toBe(204);
    });

    it("deletes an unused ingredient while other ingredients are in use", async () => {
      const { a, p } = await world();
      await ingredient(p, "Dùng", { isDefault: true });
      const spare = await ingredient(p, "Thừa");
      await create(a, p);
      const res = await request(app).delete(`/projects/${p}/ingredients/${spare}`).set(...bearer(a.token));
      expect(res.status).toBe(204);
    });
  });

  describe("last write wins and access (AC 13)", () => {
    it("keeps the newer name, price, sizes and lines when an older edit arrives later", async () => {
      const { a, b, p } = await world();
      const tea = await ingredient(p, "Trà");
      const prod = (await create(a, p, body({ sizes: ["M", "L"] }))).body;
      const newer = iso();
      const older = iso(-2000);

      await patch(a, p, prod.id, { name: { value: "Newer", editedAt: newer } });
      expect((await patch(b, p, prod.id, { name: { value: "Older", editedAt: older } })).body.name).toBe("Newer");

      await setPrice(a, p, prod.id, "M", { value: 30000, editedAt: newer });
      expect(sizeOf(await setPrice(b, p, prod.id, "M", { value: 20000, editedAt: older }), "M").sellingPrice).toBe(30000);

      await patch(a, p, prod.id, { sizes: { value: ["M"], editedAt: newer } });
      const sizes = await patch(b, p, prod.id, { sizes: { value: ["M", "L"], editedAt: older } });
      expect(sizes.body.sizes.map((s: SizeBody) => s.size)).toEqual(["M"]);

      const lines = (amount: number) => ({
        value: { lines: [{ ingredientId: tea, amount, included: true }], extras: [] },
      });
      await setLines(a, p, prod.id, "M", { ...lines(7), editedAt: newer });
      const lost = await setLines(b, p, prod.id, "M", { ...lines(9), editedAt: older });
      expect(sizeOf(lost, "M").lines[0]!.amount).toBe(7);
      const won = await setLines(b, p, prod.id, "M", { ...lines(11), editedAt: later() });
      expect(sizeOf(won, "M").lines[0]!.amount).toBe(11);
    });

    it("lets fields from different devices both win", async () => {
      const { a, b, p } = await world();
      const prod = (await create(a, p)).body;
      await patch(a, p, prod.id, { name: { value: "Tên mới", editedAt: iso() } });
      const res = await setPrice(b, p, prod.id, "M", { value: 25000, editedAt: iso(-3000) });
      expect(res.body.name).toBe("Tên mới");
      expect(sizeOf(res, "M").sellingPrice).toBe(25000);
    });

    it("a queued edit made after the create always wins, even with an old clock", async () => {
      const { a, p } = await world();
      const prod = (await create(a, p)).body;
      const res = await patch(a, p, prod.id, { name: { value: "Sau", editedAt: iso(-9000) } });
      expect(res.body.name).toBe("Sau");
    });

    it("a create sent twice with the same id is idempotent", async () => {
      const { a, p } = await world();
      const b1 = body({ name: "Một lần" });
      const first = await create(a, p, b1);
      const second = await create(a, p, b1);
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(await prisma.product.count()).toBe(1);
      // A retry that differs is answered with what was saved.
      const third = await create(a, p, { ...b1, name: "Khác", sizes: ["S"] });
      expect(third.status).toBe(200);
      expect(third.body.name).toBe("Một lần");
    });

    it("refuses an id that belongs to another project", async () => {
      const { a, p } = await world();
      const other = await seedProject();
      await addMember(other, a.id, "owner");
      const b1 = body();
      expect((await create(a, other, b1)).status).toBe(201);
      expectError(await create(a, p, b1), 409, "id_conflict");
    });

    it("answers 404 to a non-member everywhere, and 401 when signed out", async () => {
      const { a, stranger, p } = await world();
      const prod = (await create(a, p)).body;
      expectError(await get(stranger, p), 404, "not_found");
      expectError(await create(stranger, p), 404, "not_found");
      expectError(await getOne(stranger, p, prod.id), 404, "not_found");
      expectError(await patch(stranger, p, prod.id, { name: { value: "X", editedAt: iso() } }), 404, "not_found");
      expectError(await setPrice(stranger, p, prod.id, "M", { value: 1, editedAt: iso() }), 404, "not_found");
      expectError(await setLines(stranger, p, prod.id, "M", { value: { lines: [], extras: [] }, editedAt: iso() }), 404, "not_found");
      expectError(await del(stranger, p, prod.id), 404, "not_found");
      expectError(await getOne(a, p, "not-a-uuid"), 404, "not_found");
      expectError(await getOne(a, randomUUID(), prod.id), 404, "not_found");

      expectError(await request(app).get(base(p)), 401, "not_signed_in");
      expectError(await request(app).post(base(p)).send(body()), 401, "not_signed_in");
      expectError(await request(app).patch(`${base(p)}/${prod.id}`).send({}), 401, "not_signed_in");
      expectError(await request(app).patch(`${base(p)}/${prod.id}/sizes/M/price`).send({}), 401, "not_signed_in");
      expectError(await request(app).delete(`${base(p)}/${prod.id}`), 401, "not_signed_in");
    });

    it("answers 404 for a product of another project", async () => {
      const { a, p } = await world();
      const other = await seedProject();
      await addMember(other, a.id, "owner");
      const prod = (await create(a, other)).body;
      expectError(await getOne(a, p, prod.id), 404, "not_found");
      expectError(await del(a, p, prod.id), 404, "not_found");
    });
  });

  describe("target margin (AC 11)", () => {
    const patchProject = (u: User, p: string, fields: Record<string, unknown>) =>
      request(app).patch(`/projects/${p}`).set(...bearer(u.token)).send({ fields });

    it("defaults to 65 and any member can change it within 1 to 95", async () => {
      const { a, b, p } = await world();
      const list = await request(app).get("/projects").set(...bearer(a.token));
      expect(list.body[0].targetMargin).toBe(65);
      for (const value of [1, 95, 70]) {
        const res = await patchProject(b, p, { targetMargin: { value, editedAt: later() } });
        expect(res.status).toBe(200);
        expect(res.body.targetMargin).toBe(value);
      }
      expect(res0(await patchProject(a, p, { targetMargin: { value: 50, editedAt: later() } }))).toBe(50);
    });

    it("refuses 0, 96, fractions and text", async () => {
      const { a, p } = await world();
      for (const value of [0, 96, -5, 65.5, "65"]) {
        expectError(await patchProject(a, p, { targetMargin: { value, editedAt: iso() } }), 400, "validation_failed");
      }
    });

    it("keeps the newer value (last write wins)", async () => {
      const { a, b, p } = await world();
      await patchProject(a, p, { targetMargin: { value: 80, editedAt: iso() } });
      const res = await patchProject(b, p, { targetMargin: { value: 40, editedAt: iso(-2000) } });
      expect(res.body.targetMargin).toBe(80);
    });

    it("still keeps the other project fields to the owner", async () => {
      const { b, p } = await world();
      const res = await patchProject(b, p, {
        name: { value: "X", editedAt: iso() },
        targetMargin: { value: 70, editedAt: iso() },
      });
      expectError(res, 403, "forbidden");
      const stranger = await user();
      expectError(await patchProject(stranger, p, { targetMargin: { value: 70, editedAt: iso() } }), 404, "not_found");
    });

    function res0(r: { body: { targetMargin: number } }) {
      return r.body.targetMargin;
    }
  });
});
