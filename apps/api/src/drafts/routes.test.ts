import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { MAX_DRAFTS_PER_PROJECT, MAX_LINES_PER_DRAFT } from "./routes.js";

describe("/projects/:projectId/drafts", () => {
  useTestApp();
  const clock = createClock();
  const app = createApp({ prisma, now: clock.now });

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  const later = () => {
    clock.advanceMs(1000);
    return iso();
  };
  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);

  async function world(currency: "VND" | "USD" = "VND") {
    const a = await user();
    const b = await user();
    const stranger = await user();
    const t0 = clock.now();
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency, nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0, targetMarginEditedAt: new Date(0) },
    });
    const p = project.id;
    await addMember(p, a.id, "owner");
    await addMember(p, b.id, "member");
    clock.advanceMs(10_000);
    return { a, b, stranger, p };
  }

  async function ingredient(p: string, name: string) {
    const row = await prisma.ingredient.create({
      data: { id: randomUUID(), projectId: p, name, nameKey: name.toLowerCase(), mode: "weight", quantity: 1000, unit: "g", price: 10000 },
    });
    return row.id;
  }

  const base = (p: string) => `/projects/${p}/drafts`;
  const body = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), name: "Trà vải", sizes: ["M", "L"], ...over });
  const create = (u: User, p: string, b: Record<string, unknown> = body()) =>
    request(app).post(base(p)).set(...bearer(u.token)).send(b);
  const patch = (u: User, p: string, id: string, b: Record<string, unknown>) =>
    request(app).patch(`${base(p)}/${id}`).set(...bearer(u.token)).send(b);
  const list = (u: User, p: string) => request(app).get(base(p)).set(...bearer(u.token));
  const del = (u: User, p: string, id: string) => request(app).delete(`${base(p)}/${id}`).set(...bearer(u.token));
  const addLine = (u: User, p: string, d: string, b: Record<string, unknown>) =>
    request(app).post(`${base(p)}/${d}/lines`).set(...bearer(u.token)).send(b);
  const patchLine = (u: User, p: string, d: string, l: string, b: Record<string, unknown>) =>
    request(app).patch(`${base(p)}/${d}/lines/${l}`).set(...bearer(u.token)).send(b);
  const delLine = (u: User, p: string, d: string, l: string) =>
    request(app).delete(`${base(p)}/${d}/lines/${l}`).set(...bearer(u.token));
  const existingLine = (ingredientId: string, over: Record<string, unknown> = {}) => ({
    id: randomUUID(), kind: "existing", ingredientId, amount: 30, ...over,
  });
  const newLine = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(), kind: "new", newName: "Vải hộp", newKind: "weight", amount: 120, ...over,
  });
  const missingCodes = (res: { body: { error: { details?: { missing?: { code: string }[] } } } }) =>
    (res.body.error.details?.missing ?? []).map((m) => m.code);
  const idOf = (d: Record<string, unknown>) => d["id"] as string;

  describe("drafts (AC1)", () => {
    it("creates, lists, edits and deletes a draft", async () => {
      const { a, b, p } = await world();
      const d = body({ sizes: ["L", "M"] });
      const res = await create(a, p, d);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: d["id"], projectId: p, name: "Trà vải", sizes: ["M", "L"], expectedPrice: null, note: "",
        status: "working", productId: null, convertedAt: null, lines: [],
      });
      const got = await list(b, p);
      expect(got.status).toBe(200);
      expect(got.body.drafts).toHaveLength(1);
      const t = later();
      const edited = await patch(b, p, idOf(d), {
        name: { value: "Trà vải hoa hồng", editedAt: t },
        sizes: { value: ["S"], editedAt: t },
        expectedPrice: { value: 45000, editedAt: t },
        note: { value: "Thử mùa hè", editedAt: t },
      });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ name: "Trà vải hoa hồng", sizes: ["S"], expectedPrice: 45000, note: "Thử mùa hè" });
      const cleared = await patch(a, p, idOf(d), { expectedPrice: { value: null, editedAt: later() } });
      expect(cleared.body.expectedPrice).toBeNull();
      expect((await del(a, p, idOf(d))).status).toBe(204);
      expect((await list(a, p)).body.drafts).toHaveLength(0);
    });

    it("refuses an empty name, no sizes, repeated sizes and a price over the currency maximum", async () => {
      const { a, p } = await world("USD");
      expectError(await create(a, p, body({ name: "  " })), 400, "validation_failed");
      expectError(await create(a, p, body({ sizes: [] })), 400, "validation_failed");
      expectError(await create(a, p, body({ sizes: ["M", "M"] })), 400, "validation_failed");
      expectError(await create(a, p, body({ extra: 1 })), 400, "validation_failed");
      const d = body();
      expect((await create(a, p, d)).status).toBe(201);
      const t = later();
      expectError(await patch(a, p, idOf(d), { expectedPrice: { value: 10_000_001, editedAt: t } }), 400, "validation_failed");
      expectError(await patch(a, p, idOf(d), { sizes: { value: [], editedAt: t } }), 400, "validation_failed");
      expectError(await patch(a, p, idOf(d), {}), 400, "validation_failed");
    });

    it("refuses the 201st unconverted draft; converted ones do not count", async () => {
      const { a, p } = await world();
      const t = clock.now();
      await prisma.draft.createMany({
        data: Array.from({ length: MAX_DRAFTS_PER_PROJECT }, (_, i) => ({
          id: randomUUID(), projectId: p, name: `D${i}`, sizes: ["M" as const],
          ...(i === 0 ? { convertedAt: t } : {}),
        })),
      });
      expect((await create(a, p)).status).toBe(201);
      expectError(await create(a, p), 409, "draft_limit_reached");
    });
  });

  describe("lines (AC2)", () => {
    it("adds, edits and removes both kinds of line", async () => {
      const { a, p } = await world();
      const d = body();
      await create(a, p, d);
      const milk = await ingredient(p, "Sữa");
      const l1 = existingLine(milk);
      const r1 = await addLine(a, p, idOf(d), l1);
      expect(r1.status).toBe(201);
      expect(r1.body.lines[0]).toMatchObject({ id: l1.id, kind: "existing", ingredientId: milk, amount: 30, newName: null });
      const l2 = newLine({ purchaseQty: 500, purchasePrice: 90000 });
      const r2 = await addLine(a, p, idOf(d), l2);
      expect(r2.body.lines).toHaveLength(2);
      expect(r2.body.lines[1]).toMatchObject({ kind: "new", newName: "Vải hộp", newKind: "weight", purchaseQty: 500, purchasePrice: 90000, amount: 120, ingredientId: null });
      const t = later();
      const e1 = await patchLine(a, p, idOf(d), l1.id, { amount: { value: 45.5, editedAt: t } });
      expect(e1.status).toBe(200);
      expect(e1.body.lines[0].amount).toBe(45.5);
      const e2 = await patchLine(a, p, idOf(d), l2.id, {
        newName: { value: "Vải tươi", editedAt: t }, newKind: { value: "portion", editedAt: t },
        purchaseQty: { value: null, editedAt: t }, purchasePrice: { value: 1000, editedAt: t },
      });
      expect(e2.body.lines[1]).toMatchObject({ newName: "Vải tươi", newKind: "portion", purchaseQty: null, purchasePrice: 1000 });
      expect((await delLine(a, p, idOf(d), l1.id)).status).toBe(204);
      expect((await list(a, p)).body.drafts[0].lines).toHaveLength(1);
      expectError(await delLine(a, p, idOf(d), l1.id), 404, "not_found");
    });

    it("refuses a duplicate ingredient, amount 0, and bad line shapes", async () => {
      const { a, p } = await world();
      const d = body();
      await create(a, p, d);
      const milk = await ingredient(p, "Sữa");
      expect((await addLine(a, p, idOf(d), existingLine(milk))).status).toBe(201);
      expectError(await addLine(a, p, idOf(d), existingLine(milk)), 409, "draft_line_duplicate");
      expectError(await addLine(a, p, idOf(d), existingLine(await ingredient(p, "Đường"), { amount: 0 })), 400, "validation_failed");
      expectError(await addLine(a, p, idOf(d), existingLine(await ingredient(p, "Đá"), { amount: 100_001 })), 400, "validation_failed");
      expectError(await addLine(a, p, idOf(d), newLine({ amount: 0 })), 400, "validation_failed");
      expectError(await addLine(a, p, idOf(d), newLine({ newName: "" })), 400, "validation_failed");
      expectError(await addLine(a, p, idOf(d), newLine({ newKind: "bad" })), 400, "validation_failed");
      expectError(await addLine(a, p, idOf(d), newLine({ purchaseQty: 0 })), 400, "validation_failed");
      expectError(await addLine(a, p, idOf(d), newLine({ purchasePrice: -1 })), 400, "validation_failed");
      expectError(await addLine(a, p, idOf(d), existingLine(milk, { newName: "x" })), 400, "validation_failed");
      // an ingredient of another project
      const other = await world();
      const foreign = await ingredient(other.p, "Lạ");
      expectError(await addLine(a, p, idOf(d), existingLine(foreign)), 400, "validation_failed");
    });

    it("refuses a new-line name that clashes with an ingredient or another new line", async () => {
      const { a, p } = await world();
      const d = body();
      await create(a, p, d);
      await ingredient(p, "Vải hộp");
      expectError(await addLine(a, p, idOf(d), newLine({ newName: "  VẢI HỘP " })), 409, "ingredient_name_taken");
      expect((await addLine(a, p, idOf(d), newLine({ newName: "Lychee" }))).status).toBe(201);
      expectError(await addLine(a, p, idOf(d), newLine({ newName: "lychee" })), 409, "draft_line_name_taken");
      const other = newLine({ newName: "Khác" });
      await addLine(a, p, idOf(d), other);
      const t = later();
      expectError(await patchLine(a, p, idOf(d), other.id, { newName: { value: "LYCHEE", editedAt: t } }), 409, "draft_line_name_taken");
      expectError(await patchLine(a, p, idOf(d), other.id, { newName: { value: "Vải hộp", editedAt: t } }), 409, "ingredient_name_taken");
    });

    it("refuses line 101", async () => {
      const { a, p } = await world();
      const d = body();
      await create(a, p, d);
      const rows = Array.from({ length: MAX_LINES_PER_DRAFT }, (_, i) => ({
        id: randomUUID(), draftId: idOf(d), kind: "new" as const, newName: `N${i}`, newNameKey: `n${i}`, newKind: "weight" as const, amount: 1,
      }));
      await prisma.draftLine.createMany({ data: rows });
      expectError(await addLine(a, p, idOf(d), newLine()), 409, "draft_line_limit_reached");
    });

    it("refuses new-only fields on an existing line, and checks the money range", async () => {
      const { a, p } = await world("USD");
      const d = body();
      await create(a, p, d);
      const l = existingLine(await ingredient(p, "Sữa"));
      await addLine(a, p, idOf(d), l);
      const t = later();
      expectError(await patchLine(a, p, idOf(d), l.id, { purchasePrice: { value: 5, editedAt: t } }), 400, "validation_failed");
      expectError(await addLine(a, p, idOf(d), newLine({ purchasePrice: 10_000_001 })), 400, "validation_failed");
    });

    it("keeps a line when the ingredient is deleted (link cleared)", async () => {
      const { a, p } = await world();
      const d = body();
      await create(a, p, d);
      const milk = await ingredient(p, "Sữa");
      await addLine(a, p, idOf(d), existingLine(milk));
      await prisma.ingredient.delete({ where: { id: milk } });
      const lines = (await list(a, p)).body.drafts[0].lines;
      expect(lines).toHaveLength(1);
      expect(lines[0].ingredientId).toBeNull();
    });
  });

  describe("sync, access and converted drafts (AC3)", () => {
    it("is idempotent by id, and another project's id conflicts", async () => {
      const { a, p } = await world();
      const other = await world();
      const d = body();
      expect((await create(a, p, d)).status).toBe(201);
      const again = await create(a, p, { ...d, name: "Khác" });
      expect(again.status).toBe(200);
      expect(again.body.name).toBe("Trà vải");
      expect((await list(a, p)).body.drafts).toHaveLength(1);
      expectError(await create(other.a, other.p, d), 409, "id_conflict");
      const milk = await ingredient(p, "Sữa");
      const l = existingLine(milk);
      expect((await addLine(a, p, idOf(d), l)).status).toBe(201);
      const retry = await addLine(a, p, idOf(d), l);
      expect(retry.status).toBe(200);
      expect(retry.body.lines).toHaveLength(1);
      const d2 = body();
      await create(a, p, d2);
      expectError(await addLine(a, p, idOf(d2), l), 409, "id_conflict");
    });

    it("resolves each field by last write wins, and a stale field never blocks a winning one", async () => {
      const { a, b, p } = await world();
      const d = body();
      await create(a, p, d);
      const old = iso();
      const t = later();
      await patch(a, p, idOf(d), { name: { value: "Mới", editedAt: t } });
      const res = await patch(b, p, idOf(d), {
        name: { value: "Cũ", editedAt: old },
        note: { value: "ghi chú", editedAt: t },
        expectedPrice: { value: 1000, editedAt: t },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: "Mới", note: "ghi chú", expectedPrice: 1000 });
      // a stale status "done" on an incomplete draft loses quietly instead of being refused
      await patch(a, p, idOf(d), { status: { value: "working", editedAt: later() } });
      const stale = await patch(b, p, idOf(d), {
        status: { value: "done", editedAt: old },
        note: { value: "mới hơn", editedAt: later() },
      });
      expect(stale.status).toBe(200);
      expect(stale.body).toMatchObject({ status: "working", note: "mới hơn" });
      // a stale new-line name that would clash loses quietly
      await addLine(a, p, idOf(d), newLine({ newName: "Lychee" }));
      const l2 = newLine({ newName: "Dâu" });
      await addLine(a, p, idOf(d), l2);
      await patchLine(a, p, idOf(d), l2.id, { newName: { value: "Dâu tây", editedAt: later() } });
      const lres = await patchLine(a, p, idOf(d), l2.id, {
        newName: { value: "Lychee", editedAt: old },
        amount: { value: 77, editedAt: later() },
      });
      expect(lres.status).toBe(200);
      expect(lres.body.lines.find((x: { id: string }) => x.id === l2.id)).toMatchObject({ newName: "Dâu tây", amount: 77 });
    });

    it("is 404 for a non-member and 401 when signed out", async () => {
      const { a, stranger, p } = await world();
      const d = body();
      await create(a, p, d);
      expectError(await create(stranger, p), 404, "not_found");
      expectError(await list(stranger, p), 404, "not_found");
      expectError(await patch(stranger, p, idOf(d), { note: { value: "x", editedAt: later() } }), 404, "not_found");
      expectError(await del(stranger, p, idOf(d)), 404, "not_found");
      expectError(await addLine(stranger, p, idOf(d), newLine()), 404, "not_found");
      expect((await request(app).get(base(p))).status).toBe(401);
      expect((await request(app).post(base(p)).send(body())).status).toBe(401);
      expectError(await patch(a, p, randomUUID(), { note: { value: "x", editedAt: later() } }), 404, "not_found");
    });

    it("refuses every edit of a converted draft with 409 draft_converted", async () => {
      const { a, p } = await world();
      const d = body();
      await create(a, p, d);
      const l = newLine({ purchaseQty: 1, purchasePrice: 1 });
      await addLine(a, p, idOf(d), l);
      await prisma.draft.update({ where: { id: idOf(d) }, data: { convertedAt: clock.now(), status: "done" } });
      const t = later();
      expectError(await patch(a, p, idOf(d), { note: { value: "x", editedAt: t } }), 409, "draft_converted");
      expectError(await del(a, p, idOf(d)), 409, "draft_converted");
      expectError(await addLine(a, p, idOf(d), newLine({ newName: "Khác" })), 409, "draft_converted");
      expectError(await patchLine(a, p, idOf(d), l.id, { amount: { value: 2, editedAt: t } }), 409, "draft_converted");
      expectError(await delLine(a, p, idOf(d), l.id), 409, "draft_converted");
      const got = (await list(a, p)).body.drafts[0];
      expect(got.convertedAt).not.toBeNull();
      expect(got.lines).toHaveLength(1);
    });
  });

  describe("status (AC5)", () => {
    it("refuses done with a missing list for each rule, and allows done and back to working", async () => {
      const { a, p } = await world();
      const d = body();
      await create(a, p, d);
      const none = await patch(a, p, idOf(d), { status: { value: "done", editedAt: later() } });
      expect(none.status).toBe(409);
      expect(none.body.error.code).toBe("draft_incomplete");
      expect(missingCodes(none)).toEqual(["lines"]);
      // a new line without a price names the line
      const l = newLine({ purchaseQty: 500 });
      await addLine(a, p, idOf(d), l);
      const noPrice = await patch(a, p, idOf(d), { status: { value: "done", editedAt: later() } });
      expect(noPrice.status).toBe(409);
      expect(noPrice.body.error.details.missing).toEqual([{ code: "line_price", lineId: l.id, name: "Vải hộp" }]);
      // the refused change leaves the status alone
      expect((await list(a, p)).body.drafts[0].status).toBe("working");
      await patchLine(a, p, idOf(d), l.id, { purchasePrice: { value: 9000, editedAt: later() } });
      const ok = await patch(a, p, idOf(d), { status: { value: "done", editedAt: later() } });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe("done");
      const back = await patch(a, p, idOf(d), { status: { value: "working", editedAt: later() } });
      expect(back.body.status).toBe("working");
    });

    it("counts a line whose ingredient was deleted", async () => {
      const { a, p } = await world();
      const d = body();
      await create(a, p, d);
      const milk = await ingredient(p, "Sữa");
      await addLine(a, p, idOf(d), existingLine(milk));
      await prisma.ingredient.delete({ where: { id: milk } });
      const res = await patch(a, p, idOf(d), { status: { value: "done", editedAt: later() } });
      expect(res.status).toBe(409);
      expect(missingCodes(res)).toEqual(["line_ingredient_missing"]);
    });
  });

  describe("currency lock (AC12)", () => {
    const changeCurrency = (u: User, p: string, to: "VND" | "USD") =>
      request(app).patch(`/projects/${p}`).set(...bearer(u.token)).send({ fields: { currency: { value: to, editedAt: later() } } });

    it("refuses a currency change once a draft has an expected price", async () => {
      const { a, p } = await world();
      const d = body();
      await create(a, p, d);
      expect((await changeCurrency(a, p, "USD")).status).toBe(200);
      await patch(a, p, idOf(d), { expectedPrice: { value: 4000, editedAt: later() } });
      expectError(await changeCurrency(a, p, "VND"), 409, "currency_locked");
    });

    it("refuses it once a new line has a purchase price", async () => {
      const { a, p } = await world();
      const d = body();
      await create(a, p, d);
      await addLine(a, p, idOf(d), newLine({ purchasePrice: 5000 }));
      expectError(await changeCurrency(a, p, "USD"), 409, "currency_locked");
    });

    it("allows it when drafts carry no money", async () => {
      const { a, p } = await world();
      const d = body();
      await create(a, p, d);
      await addLine(a, p, idOf(d), newLine({ purchaseQty: 100 }));
      expect((await changeCurrency(a, p, "USD")).status).toBe(200);
    });
  });
});
