import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { MAX_FIXED_COSTS_PER_PROJECT } from "./fixedCosts.js";

describe("/projects/:projectId/fixed-costs", () => {
  useTestApp();
  const clock = createClock();
  const app = createApp({ prisma, now: clock.now });

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  type User = { id: string; token: string };

  async function world(currency: "VND" | "USD" = "VND") {
    const a = await createSignedInUser(clock);
    const b = await createSignedInUser(clock);
    const stranger = await createSignedInUser(clock);
    const t0 = clock.now();
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency, nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0, expectedCupsEditedAt: new Date(0) },
    });
    await addMember(project.id, a.id, "owner");
    await addMember(project.id, b.id, "member");
    clock.advanceMs(10_000);
    return { a, b, stranger, p: project.id };
  }

  const base = (p: string) => `/projects/${p}/fixed-costs`;
  const body = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    name: "Mặt bằng",
    kind: "monthly",
    amount: 5_000_000,
    ...over,
  });
  const create = (u: User, p: string, b: Record<string, unknown> = body()) =>
    request(app).post(base(p)).set(...bearer(u.token)).send(b);
  const patch = (u: User, p: string, id: string, b: Record<string, unknown>) =>
    request(app).patch(`${base(p)}/${id}`).set(...bearer(u.token)).send(b);
  const list = (u: User, p: string) => request(app).get(base(p)).set(...bearer(u.token));
  const del = (u: User, p: string, id: string) => request(app).delete(`${base(p)}/${id}`).set(...bearer(u.token));

  it("creates, lists in creation order, edits every field and deletes", async () => {
    const { a, b, p } = await world();
    const rent = await create(a, p, body({ name: "  Mặt bằng " }));
    expect(rent.status).toBe(201);
    expect(rent.body).toMatchObject({ projectId: p, name: "Mặt bằng", kind: "monthly", amount: 5_000_000, months: null });
    clock.advanceMs(1000);
    const machine = await create(b, p, body({ name: "Máy pha", kind: "oneTime", amount: 18_000_000, months: 24 }));
    expect(machine.status).toBe(201);
    expect(machine.body).toMatchObject({ kind: "oneTime", months: 24 });
    const all = await list(a, p);
    expect(all.body.fixedCosts.map((x: { name: string }) => x.name)).toEqual(["Mặt bằng", "Máy pha"]);

    const edited = await patch(a, p, rent.body.id, {
      name: { value: "Thuê quán", editedAt: iso() },
      kind: { value: "weekly", editedAt: iso() },
      amount: { value: 600_000, editedAt: iso() },
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: "Thuê quán", kind: "weekly", amount: 600_000, months: null });

    // To one-time needs months, and months can then change on their own.
    clock.advanceMs(1000);
    const toOneTime = await patch(a, p, rent.body.id, {
      kind: { value: "oneTime", editedAt: iso() },
      months: { value: 12, editedAt: iso() },
    });
    expect(toOneTime.body).toMatchObject({ kind: "oneTime", months: 12 });
    clock.advanceMs(1000);
    const moreMonths = await patch(a, p, rent.body.id, { months: { value: 36, editedAt: iso() } });
    expect(moreMonths.body.months).toBe(36);

    // Changing the kind away from one-time clears the months.
    clock.advanceMs(1000);
    const toMonthly = await patch(a, p, rent.body.id, { kind: { value: "monthly", editedAt: iso() } });
    expect(toMonthly.status).toBe(200);
    expect(toMonthly.body).toMatchObject({ kind: "monthly", months: null });

    expect((await del(a, p, rent.body.id)).status).toBe(204);
    expect((await list(a, p)).body.fixedCosts).toHaveLength(1);
    expectError(await del(a, p, rent.body.id), 404, "not_found");
  });

  it("refuses bad names, amounts, kinds and months", async () => {
    const { a, p } = await world("VND");
    await create(a, p, body({ name: "Điện" }));
    const bads: Record<string, unknown>[] = [
      { name: "" },
      { name: "   " },
      { name: "x".repeat(81) },
      { name: "ĐIỆN" }, // duplicate, case-insensitive
      { name: " điện " },
      { amount: 0 },
      { amount: -1 },
      { amount: 1.5 },
      { amount: 1_000_000_001 },
      { kind: "yearly" },
      { kind: "oneTime" }, // months missing
      { kind: "oneTime", months: 0 },
      { kind: "oneTime", months: 121 },
      { kind: "oneTime", months: 1.5 },
      { kind: "monthly", months: 6 },
      { kind: "weekly", months: 1 },
    ];
    for (const bad of bads) expectError(await create(a, p, body(bad)), 400, "validation_failed");
    expect((await create(a, p, body({ name: "x".repeat(80), kind: "oneTime", months: 120 }))).status).toBe(201);
    expect((await create(a, p, body({ name: "Null months", kind: "monthly", months: null }))).status).toBe(201);
    expect((await create(a, p, body({ name: "One month", kind: "oneTime", months: 1, amount: 1 }))).status).toBe(201);

    const usd = await world("USD");
    expectError(await create(usd.a, usd.p, body({ amount: 10_000_001 })), 400, "validation_failed");
    expect((await create(usd.a, usd.p, body({ amount: 10_000_000 }))).status).toBe(201);
  });

  it("refuses bad edits", async () => {
    const { a, p } = await world();
    const one = (await create(a, p, body({ name: "Một" }))).body;
    await create(a, p, body({ name: "Ba" }));
    const two = (await create(a, p, body({ name: "Hai", kind: "oneTime", months: 10 }))).body;
    const bads: Record<string, unknown>[] = [
      {},
      { name: { value: "", editedAt: iso() } },
      { name: { value: "BA", editedAt: iso() } }, // taken by another item
      { amount: { value: 0, editedAt: iso() } },
      { amount: { value: 1_000_000_001, editedAt: iso() } },
      { kind: { value: "oneTime", editedAt: iso() } }, // months missing
      { kind: { value: "oneTime", editedAt: iso() }, months: { value: 121, editedAt: iso() } },
      { kind: { value: "weekly", editedAt: iso() }, months: { value: 5, editedAt: iso() } },
      { unknown: { value: 1, editedAt: iso() } },
    ];
    for (const bad of bads) expectError(await patch(a, p, one.id, bad), 400, "validation_failed");
    expectError(await patch(a, p, two.id, { months: { value: null, editedAt: iso() } }), 400, "validation_failed");
    expectError(await patch(a, p, two.id, { months: { value: 0, editedAt: iso() } }), 400, "validation_failed");
    // A change of case on its own name is allowed.
    expect((await patch(a, p, one.id, { name: { value: "MỘT", editedAt: iso() } })).status).toBe(200);
  });

  it("refuses the 51st fixed cost with fixed_cost_limit_reached", async () => {
    const { a, p } = await world();
    await prisma.fixedCost.createMany({
      data: Array.from({ length: MAX_FIXED_COSTS_PER_PROJECT }, (_, i) => ({
        id: randomUUID(),
        projectId: p,
        name: `F${i}`,
        nameKey: `f${i}`,
        kind: "monthly" as const,
        amount: 1,
      })),
    });
    expectError(await create(a, p), 409, "fixed_cost_limit_reached");
    expect(await prisma.fixedCost.count()).toBe(MAX_FIXED_COSTS_PER_PROJECT);
  });

  it("keeps the newer value per field (last write wins)", async () => {
    const { a, b, p } = await world();
    const one = (await create(a, p)).body;
    await patch(a, p, one.id, { amount: { value: 900, editedAt: iso() } });
    const res = await patch(b, p, one.id, {
      amount: { value: 100, editedAt: iso(-2000) },
      name: { value: "Tiền thuê", editedAt: iso() },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: 900, name: "Tiền thuê" });
  });

  it("lets an edit queued right after a create win over the create", async () => {
    const { a, p } = await world();
    const one = (await create(a, p)).body;
    const res = await patch(a, p, one.id, { amount: { value: 1, editedAt: iso(-5000) } });
    expect(res.body.amount).toBe(1);
  });

  it("keeps kind and months consistent when last write wins splits them", async () => {
    const { a, p } = await world();
    const consistent = async (id: string) => {
      const row = await prisma.fixedCost.findFirstOrThrow({ where: { id } });
      expect(row.kind === "oneTime").toBe(row.months !== null);
      return row;
    };

    // (a) a stale kind edit must not null the months of a one-time cost whose kind was edited later.
    const a1 = (await create(a, p, body({ name: "A" }))).body;
    const toOne = await patch(a, p, a1.id, { kind: { value: "oneTime", editedAt: iso(-1000) }, months: { value: 12, editedAt: iso(-5000) } });
    expect(toOne.body).toMatchObject({ kind: "oneTime", months: 12 });
    const stale = await patch(a, p, a1.id, { kind: { value: "monthly", editedAt: iso(-3000) } });
    expect(stale.status).toBe(200);
    expect(stale.body).toMatchObject({ kind: "oneTime", months: 12 });
    expect(await consistent(a1.id)).toMatchObject({ kind: "oneTime", months: 12 });

    // (b) a kind edit that wins while the months edit is newer must still end with no months.
    const b1 = (await create(a, p, body({ name: "B", kind: "oneTime", months: 24 }))).body;
    await patch(a, p, b1.id, { months: { value: 24, editedAt: iso(-1000) } });
    const toWeekly = await patch(a, p, b1.id, { kind: { value: "weekly", editedAt: iso(-3000) } });
    expect(toWeekly.status).toBe(200);
    expect(toWeekly.body).toMatchObject({ kind: "weekly", months: null });
    expect(await consistent(b1.id)).toMatchObject({ kind: "weekly", months: null });
    // Back to one-time needs the months, which the client always sends.
    expectError(await patch(a, p, b1.id, { kind: { value: "oneTime", editedAt: iso() } }), 400, "validation_failed");
    const back = await patch(a, p, b1.id, { kind: { value: "oneTime", editedAt: iso() }, months: { value: 24, editedAt: iso() } });
    expect(back.body).toMatchObject({ kind: "oneTime", months: 24 });
  });

  it("applies winning fields when a kind or months edit in the same request is stale", async () => {
    const { a, p } = await world();
    const row = async (id: string) => prisma.fixedCost.findFirstOrThrow({ where: { id } });

    // Stale months + winning amount, the item having become monthly meanwhile.
    const x = (await create(a, p, body({ name: "X", kind: "oneTime", months: 24, amount: 100 }))).body;
    await patch(a, p, x.id, { kind: { value: "monthly", editedAt: iso() } });
    const res = await patch(a, p, x.id, {
      amount: { value: 555, editedAt: iso(-1000) },
      months: { value: 12, editedAt: iso(-1000) },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "monthly", amount: 555, months: null });
    expect(await row(x.id)).toMatchObject({ kind: "monthly", amount: 555, months: null });

    // Stale kind + winning name: the kind and its months stay.
    const y = (await create(a, p, body({ name: "Y", kind: "oneTime", months: 24 }))).body;
    await patch(a, p, y.id, { kind: { value: "oneTime", editedAt: iso() }, months: { value: 24, editedAt: iso() } });
    const res2 = await patch(a, p, y.id, {
      kind: { value: "weekly", editedAt: iso(-3000) },
      name: { value: "Y2", editedAt: iso() },
    });
    expect(res2.status).toBe(200);
    expect(res2.body).toMatchObject({ name: "Y2", kind: "oneTime", months: 24 });

    // A winning kind change clears the months and stamps them with the kind's time.
    const z = (await create(a, p, body({ name: "Z", kind: "oneTime", months: 24 }))).body;
    const at = iso(-500);
    const res3 = await patch(a, p, z.id, { kind: { value: "weekly", editedAt: at } });
    expect(res3.status).toBe(200);
    const zr = await row(z.id);
    expect(zr).toMatchObject({ kind: "weekly", months: null });
    expect(zr.monthsEditedAt.getTime()).toBe(zr.kindEditedAt.getTime());
    expect(zr.kindEditedAt.toISOString()).toBe(new Date(at).toISOString());
  });

  it("is idempotent by id and refuses another project's id", async () => {
    const { a, p } = await world();
    const b1 = body();
    expect((await create(a, p, b1)).status).toBe(201);
    const again = await create(a, p, b1);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(b1.id);
    expect(await prisma.fixedCost.count()).toBe(1);

    const other = await world();
    expectError(await create(other.a, other.p, b1), 409, "id_conflict");
  });

  it("hides the list from non-members and needs a sign-in", async () => {
    const { a, stranger, p } = await world();
    const one = (await create(a, p)).body;
    expectError(await list(stranger, p), 404, "not_found");
    expectError(await create(stranger, p), 404, "not_found");
    expectError(await patch(stranger, p, one.id, { amount: { value: 2, editedAt: iso() } }), 404, "not_found");
    expectError(await del(stranger, p, one.id), 404, "not_found");
    expectError(await request(app).get(base(p)), 401, "not_signed_in");
    expectError(await request(app).post(base(p)).send(body()), 401, "not_signed_in");
    expectError(await list(a, "not-a-uuid"), 404, "not_found");
  });

  describe("expected cups per month on the project", () => {
    const patchProject = (u: User, p: string, fields: Record<string, unknown>) =>
      request(app).patch(`/projects/${p}`).set(...bearer(u.token)).send({ fields });

    it("starts unset, then any member sets, changes and clears it", async () => {
      const { a, b, p } = await world();
      const listed = await request(app).get("/projects").set(...bearer(a.token));
      expect(listed.body[0].expectedCupsPerMonth).toBeNull();
      for (const value of [1500, 1, 1_000_000, null]) {
        clock.advanceMs(1000);
        const res = await patchProject(b, p, { expectedCupsPerMonth: { value, editedAt: iso() } });
        expect(res.status).toBe(200);
        expect(res.body.expectedCupsPerMonth).toBe(value);
      }
    });

    it("refuses 0, 1,000,001, fractions and text", async () => {
      const { a, p } = await world();
      for (const value of [0, -5, 1_000_001, 1.5, "10"]) {
        expectError(await patchProject(a, p, { expectedCupsPerMonth: { value, editedAt: iso() } }), 400, "validation_failed");
      }
    });

    it("keeps the newer value (last write wins), including a clear", async () => {
      const { a, b, p } = await world();
      await patchProject(a, p, { expectedCupsPerMonth: { value: 800, editedAt: iso() } });
      const older = await patchProject(b, p, { expectedCupsPerMonth: { value: 100, editedAt: iso(-2000) } });
      expect(older.body.expectedCupsPerMonth).toBe(800);
      const olderClear = await patchProject(b, p, { expectedCupsPerMonth: { value: null, editedAt: iso(-1000) } });
      expect(olderClear.body.expectedCupsPerMonth).toBe(800);
      clock.advanceMs(1000);
      const clear = await patchProject(b, p, { expectedCupsPerMonth: { value: null, editedAt: iso() } });
      expect(clear.body.expectedCupsPerMonth).toBeNull();
    });

    it("lets a queued cups edit win over the project's creation, and refuses non-members", async () => {
      const a = await createSignedInUser(clock);
      const stranger = await createSignedInUser(clock);
      const id = randomUUID();
      await request(app)
        .post("/projects")
        .set(...bearer(a.token))
        .send({ id, name: "Q", currency: "VND", editedAt: iso() })
        .expect(201);
      const res = await patchProject(a, id, { expectedCupsPerMonth: { value: 900, editedAt: iso(-5000) } });
      expect(res.body.expectedCupsPerMonth).toBe(900);
      expectError(await patchProject(stranger, id, { expectedCupsPerMonth: { value: 5, editedAt: iso() } }), 404, "not_found");
    });
  });
});
