import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { MAX_INGREDIENTS_PER_PROJECT } from "../ingredients/create.js";
import { MAX_PRODUCTS_PER_PROJECT } from "../products/create.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";

describe("POST /projects/:projectId/drafts/:draftId/convert", () => {
  useTestApp();
  const clock = createClock();
  const app = createApp({ prisma, now: clock.now });
  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  type User = { id: string; token: string };

  async function world() {
    const a = await createSignedInUser(clock);
    const stranger = await createSignedInUser(clock);
    const t0 = clock.now();
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0, targetMarginEditedAt: new Date(0) },
    });
    await addMember(project.id, a.id, "owner");
    return { a, stranger, p: project.id };
  }

  async function ingredient(p: string, name: string, over: { isDefault?: boolean; mode?: "weight" | "volume" | "portion" } = {}) {
    const row = await prisma.ingredient.create({
      data: {
        id: randomUUID(), projectId: p, name, nameKey: name.toLowerCase(), mode: over.mode ?? "weight",
        quantity: 1000, unit: "g", price: 10000, isDefault: over.isDefault ?? false,
      },
    });
    return row.id;
  }

  const filler = (p: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: randomUUID(), projectId: p, name: `I${i}`, nameKey: `i${i}`, mode: "weight" as const, quantity: 1, unit: "g", price: 1,
    }));

  type LineSeed =
    | { kind: "existing"; ingredientId: string; amount: number }
    | { kind: "new"; name: string; mode?: "weight" | "volume" | "portion"; qty?: number | null; price?: number | null; amount: number };

  async function draft(
    p: string,
    lines: LineSeed[],
    over: { status?: "working" | "done"; name?: string; sizes?: ("S" | "M" | "L")[]; expectedPrice?: number | null; convertedAt?: Date } = {},
  ) {
    const id = randomUUID();
    await prisma.draft.create({
      data: {
        id, projectId: p, name: over.name ?? "Trà vải", sizes: over.sizes ?? ["L", "M"],
        expectedPrice: over.expectedPrice === undefined ? 45000 : over.expectedPrice,
        status: over.status ?? "done",
        ...(over.convertedAt ? { convertedAt: over.convertedAt } : {}),
        lines: {
          create: lines.map((l, position) =>
            l.kind === "existing"
              ? { id: randomUUID(), kind: "existing" as const, ingredientId: l.ingredientId, amount: l.amount, position }
              : {
                  id: randomUUID(), kind: "new" as const, newName: l.name, newNameKey: l.name.toLowerCase(),
                  newKind: l.mode ?? "weight", purchaseQty: l.qty === undefined ? 500 : l.qty,
                  purchasePrice: l.price === undefined ? 90000 : l.price, amount: l.amount, position,
                },
          ),
        },
      },
    });
    return id;
  }

  const convert = (u: User, p: string, d: string) =>
    request(app).post(`/projects/${p}/drafts/${d}/convert`).set(...bearer(u.token));
  const productSizes = (productId: string) =>
    prisma.productSizeRow.findMany({
      where: { productId },
      include: { lines: { orderBy: { position: "asc" } }, extras: true },
      orderBy: { size: "asc" },
    });
  const counts = async (p: string) => ({
    ingredients: await prisma.ingredient.count({ where: { projectId: p } }),
    prices: await prisma.ingredientPrice.count({ where: { ingredient: { projectId: p } } }),
    products: await prisma.product.count({ where: { projectId: p } }),
    sizes: await prisma.productSizeRow.count({ where: { product: { projectId: p } } }),
    converted: await prisma.draft.count({ where: { projectId: p, convertedAt: { not: null } } }),
  });

  it("creates the ingredients, the product, its sizes, lines, defaults and the base price (AC6)", async () => {
    const { a, p } = await world();
    const milk = await ingredient(p, "Sữa");
    const cup = await ingredient(p, "Ly", { isDefault: true, mode: "portion" });
    await prisma.extraCost.create({ data: { id: randomUUID(), projectId: p, name: "Điện", amount: 500, isDefault: true } });
    const d = await draft(p, [
      { kind: "existing", ingredientId: milk, amount: 30 },
      { kind: "new", name: "Vải hộp", mode: "weight", qty: 500, price: 90000, amount: 120 },
    ]);
    const res = await convert(a, p, d);
    expect(res.status).toBe(201);
    const created = await prisma.ingredient.findFirstOrThrow({ where: { projectId: p, name: "Vải hộp" } });
    expect(created).toMatchObject({ mode: "weight", unit: "g", price: 90000, isDefault: false });
    expect(Number(created.quantity)).toBe(500);
    expect(await prisma.ingredientPrice.count({ where: { ingredientId: created.id } })).toBe(1);
    expect(res.body.createdIngredients).toEqual([{ id: created.id, name: "Vải hộp" }]);
    expect(res.body.reusedIngredients).toEqual([]);
    expect(res.body.draft).toMatchObject({ id: d, productId: res.body.productId, status: "done" });
    expect(res.body.draft.convertedAt).toEqual(expect.any(String));

    const product = await prisma.product.findUniqueOrThrow({ where: { id: res.body.productId } });
    expect(product.name).toBe("Trà vải");
    const sizes = await productSizes(product.id);
    expect(sizes.map((s) => s.size).sort()).toEqual(["L", "M"]);
    for (const s of sizes) {
      expect(s.lines.map((l) => [l.ingredientId, Number(l.amount), l.isDefault, l.included])).toEqual([
        [cup, 1, true, true],
        [milk, 30, false, true],
        [created.id, 120, false, true],
      ]);
      expect(s.extras.map((x) => [x.name, x.amount])).toEqual([["Điện", 500]]);
    }
    expect(sizes.find((s) => s.size === "M")?.sellingPrice).toBe(45000);
    expect(sizes.find((s) => s.size === "L")?.sellingPrice).toBeNull();
    const row = await prisma.draft.findUniqueOrThrow({ where: { id: d } });
    expect(row.productId).toBe(product.id);
    expect(row.convertedAt).not.toBeNull();

    const got = await request(app).get(`/projects/${p}/products/${product.id}`).set(...bearer(a.token));
    expect(got.body.fromDraftId).toBe(d);
  });

  it("reuses an ingredient with the same name instead of creating one", async () => {
    const { a, p } = await world();
    const sugar = await ingredient(p, "Đường");
    const d = await draft(p, [{ kind: "new", name: "Đường", amount: 20 }]);
    const res = await convert(a, p, d);
    expect(res.status).toBe(201);
    expect(res.body.createdIngredients).toEqual([]);
    expect(res.body.reusedIngredients).toEqual([{ id: sugar, name: "Đường" }]);
    expect(await prisma.ingredient.count({ where: { projectId: p } })).toBe(1);
    const sizes = await productSizes(res.body.productId);
    expect(sizes[0]?.lines.map((l) => [l.ingredientId, Number(l.amount)])).toEqual([[sugar, 20]]);
  });

  it("uses the draft amount once when a default ingredient is also a draft line", async () => {
    const { a, p } = await world();
    const sugar = await ingredient(p, "Đường", { isDefault: true });
    const d = await draft(p, [{ kind: "existing", ingredientId: sugar, amount: 25 }]);
    const res = await convert(a, p, d);
    expect(res.status).toBe(201);
    for (const s of await productSizes(res.body.productId)) {
      expect(s.lines.map((l) => [l.ingredientId, Number(l.amount), l.isDefault])).toEqual([[sugar, 25, true]]);
    }
  });

  it("refuses a draft that is not done, converted, incomplete, or from another project (AC7)", async () => {
    const { a, stranger, p } = await world();
    const milk = await ingredient(p, "Sữa");
    const before = await counts(p);
    const working = await draft(p, [{ kind: "existing", ingredientId: milk, amount: 30 }], { status: "working" });
    expectError(await convert(a, p, working), 409, "draft_not_done");
    const done = await draft(p, [{ kind: "existing", ingredientId: milk, amount: 30 }]);
    expect((await convert(stranger, p, done)).status).toBe(404);
    expect((await convert(a, p, randomUUID())).status).toBe(404);
    const converted = await draft(p, [], { convertedAt: new Date() });
    expectError(await convert(a, p, converted), 409, "draft_converted");
    const incomplete = await draft(p, [{ kind: "new", name: "Vải", price: null, amount: 10 }]);
    const res = await convert(a, p, incomplete);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("draft_incomplete");
    expect(res.body.error.details.missing[0]).toMatchObject({ code: "line_price", name: "Vải" });
    expect(await counts(p)).toEqual({ ...before, converted: 1 });
    expect((await request(app).post(`/projects/${p}/drafts/${done}/convert`)).status).toBe(401);
  });

  it("refuses a taken product name, the product limit and the ingredient limit, changing nothing (AC7)", async () => {
    const { a, p } = await world();
    const milk = await ingredient(p, "Sữa");
    await prisma.product.create({ data: { id: randomUUID(), projectId: p, name: "Trà vải", nameKey: "trà vải" } });
    const taken = await draft(p, [
      { kind: "new", name: "Vải hộp", amount: 10 },
      { kind: "existing", ingredientId: milk, amount: 5 },
    ]);
    let before = await counts(p);
    expectError(await convert(a, p, taken), 409, "product_name_taken");
    expect(await counts(p)).toEqual(before);
    expect(await prisma.draft.findUniqueOrThrow({ where: { id: taken } })).toMatchObject({ productId: null, convertedAt: null });

    const w2 = await world();
    await prisma.product.createMany({
      data: Array.from({ length: MAX_PRODUCTS_PER_PROJECT }, (_, i) => ({ id: randomUUID(), projectId: w2.p, name: `P${i}`, nameKey: `p${i}` })),
    });
    const full = await draft(w2.p, [{ kind: "new", name: "Vải hộp", amount: 10 }]);
    before = await counts(w2.p);
    expectError(await convert(w2.a, w2.p, full), 409, "product_limit_reached");
    expect(await counts(w2.p)).toEqual(before);

    const w3 = await world();
    await prisma.ingredient.createMany({ data: filler(w3.p, MAX_INGREDIENTS_PER_PROJECT) });
    const many = await draft(w3.p, [{ kind: "new", name: "Vải hộp", amount: 10 }]);
    before = await counts(w3.p);
    expectError(await convert(w3.a, w3.p, many), 409, "ingredient_limit_reached");
    expect(await counts(w3.p)).toEqual(before);
  });

  it("rolls back every new ingredient when a later step fails part-way", async () => {
    const { a, p } = await world();
    await prisma.ingredient.createMany({ data: filler(p, MAX_INGREDIENTS_PER_PROJECT - 1) });
    // The first new line fits (299 -> 300), the second hits the limit.
    const d = await draft(p, [
      { kind: "new", name: "Vải hộp", amount: 10 },
      { kind: "new", name: "Hoa hồng", amount: 5 },
    ]);
    const before = await counts(p);
    expectError(await convert(a, p, d), 409, "ingredient_limit_reached");
    expect(await counts(p)).toEqual(before);
    expect(await prisma.ingredient.count({ where: { projectId: p, name: "Vải hộp" } })).toBe(0);
    expect(await prisma.draft.findUniqueOrThrow({ where: { id: d } })).toMatchObject({ productId: null, convertedAt: null });
  });

  it("answers 409 draft_converted to a second convert, and creates one product only", async () => {
    const { a, p } = await world();
    const d = await draft(p, [{ kind: "new", name: "Vải hộp", amount: 10 }]);
    const [r1, r2] = await Promise.all([convert(a, p, d), convert(a, p, d)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expectError(r1.status === 409 ? r1 : r2, 409, "draft_converted");
    expectError(await convert(a, p, d), 409, "draft_converted");
    expect(await prisma.product.count({ where: { projectId: p } })).toBe(1);
    expect(await prisma.ingredient.count({ where: { projectId: p } })).toBe(1);
  });

  it("keeps the draft read-only after its product is deleted (AC9)", async () => {
    const { a, p } = await world();
    const d = await draft(p, [{ kind: "new", name: "Vải hộp", amount: 10 }]);
    const res = await convert(a, p, d);
    expect(res.status).toBe(201);
    const del = await request(app).delete(`/projects/${p}/products/${res.body.productId}`).set(...bearer(a.token));
    expect(del.status).toBe(204);
    const row = await prisma.draft.findUniqueOrThrow({ where: { id: d } });
    expect(row.productId).toBeNull();
    expect(row.convertedAt).not.toBeNull();
    const edit = await request(app)
      .patch(`/projects/${p}/drafts/${d}`)
      .set(...bearer(a.token))
      .send({ name: { value: "Khác", editedAt: new Date(clock.now().getTime() + 5000).toISOString() } });
    expectError(edit, 409, "draft_converted");
    expectError(await convert(a, p, d), 409, "draft_converted");
    expect(await prisma.ingredient.count({ where: { projectId: p, name: "Vải hộp" } })).toBe(1);
  });

  it("gives fromDraftId null for a product not made from a draft", async () => {
    const { a, p } = await world();
    const res = await request(app)
      .post(`/projects/${p}/products`)
      .set(...bearer(a.token))
      .send({ id: randomUUID(), name: "Cà phê", sizes: ["M"] });
    expect(res.status).toBe(201);
    expect(res.body.fromDraftId).toBeNull();
    const list = await request(app).get(`/projects/${p}/products`).set(...bearer(a.token));
    expect(list.body.products[0].fromDraftId).toBeNull();
  });
});
