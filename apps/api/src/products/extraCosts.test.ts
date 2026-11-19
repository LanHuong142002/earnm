import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { addMember, createClock, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { MAX_EXTRA_COSTS_PER_PROJECT } from "./extraCosts.js";

describe("/projects/:projectId/extra-costs", () => {
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
      data: { id: randomUUID(), name: "P", currency, nameEditedAt: t0, descriptionEditedAt: t0, currencyEditedAt: t0 },
    });
    await addMember(project.id, a.id, "owner");
    await addMember(project.id, b.id, "member");
    clock.advanceMs(10_000);
    return { a, b, stranger, p: project.id };
  }

  const base = (p: string) => `/projects/${p}/extra-costs`;
  const body = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), name: "Đá", amount: 500, ...over });
  const create = (u: User, p: string, b: Record<string, unknown> = body()) =>
    request(app).post(base(p)).set(...bearer(u.token)).send(b);
  const patch = (u: User, p: string, id: string, b: Record<string, unknown>) =>
    request(app).patch(`${base(p)}/${id}`).set(...bearer(u.token)).send(b);
  const list = (u: User, p: string) => request(app).get(base(p)).set(...bearer(u.token));
  const del = (u: User, p: string, id: string) => request(app).delete(`${base(p)}/${id}`).set(...bearer(u.token));

  it("creates, lists in creation order, edits and deletes", async () => {
    const { a, b, p } = await world();
    const ice = await create(a, p, body({ name: "  Đá ", isDefault: true }));
    expect(ice.status).toBe(201);
    expect(ice.body).toMatchObject({ projectId: p, name: "Đá", amount: 500, isDefault: true });
    clock.advanceMs(1000);
    const water = await create(b, p, body({ name: "Nước", amount: 200 }));
    expect(water.body.isDefault).toBe(false);
    const all = await list(a, p);
    expect(all.body.extraCosts.map((x: { name: string }) => x.name)).toEqual(["Đá", "Nước"]);

    const edited = await patch(a, p, ice.body.id, {
      name: { value: "Đá viên", editedAt: iso() },
      amount: { value: 700, editedAt: iso() },
      isDefault: { value: false, editedAt: iso() },
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: "Đá viên", amount: 700, isDefault: false });
    expect((await del(a, p, ice.body.id)).status).toBe(204);
    expect((await list(a, p)).body.extraCosts).toHaveLength(1);
    expectError(await del(a, p, ice.body.id), 404, "not_found");
  });

  it("refuses bad names and amounts, including out of range for the currency", async () => {
    const { a, p } = await world("VND");
    for (const bad of [{ name: "" }, { name: "x".repeat(41) }, { amount: -1 }, { amount: 1.5 }, { amount: 1_000_000_001 }]) {
      expectError(await create(a, p, body(bad)), 400, "validation_failed");
    }
    const usd = await world("USD");
    expectError(await create(usd.a, usd.p, body({ amount: 10_000_001 })), 400, "validation_failed");
    expect((await create(usd.a, usd.p, body({ amount: 10_000_000 }))).status).toBe(201);
    const one = (await create(a, p)).body;
    expectError(await patch(a, p, one.id, { amount: { value: -1, editedAt: iso() } }), 400, "validation_failed");
    expectError(await patch(a, p, one.id, {}), 400, "validation_failed");
  });

  it("refuses the 51st extra cost with extra_cost_limit_reached", async () => {
    const { a, p } = await world();
    await prisma.extraCost.createMany({
      data: Array.from({ length: MAX_EXTRA_COSTS_PER_PROJECT }, (_, i) => ({
        id: randomUUID(),
        projectId: p,
        name: `E${i}`,
        amount: 1,
      })),
    });
    expectError(await create(a, p), 409, "extra_cost_limit_reached");
    expect(await prisma.extraCost.count()).toBe(MAX_EXTRA_COSTS_PER_PROJECT);
  });

  it("keeps the newer value per field (last write wins)", async () => {
    const { a, b, p } = await world();
    const one = (await create(a, p)).body;
    await patch(a, p, one.id, { amount: { value: 900, editedAt: iso() } });
    const res = await patch(b, p, one.id, {
      amount: { value: 100, editedAt: iso(-2000) },
      name: { value: "Mới", editedAt: iso(-2000) },
    });
    expect(res.body).toMatchObject({ amount: 900, name: "Mới" });
  });

  it("is idempotent for the same id, and refuses another project's id", async () => {
    const { a, p } = await world();
    const b1 = body();
    expect((await create(a, p, b1)).status).toBe(201);
    expect((await create(a, p, b1)).status).toBe(200);
    expect(await prisma.extraCost.count()).toBe(1);
    const other = await world();
    expectError(await create(other.a, other.p, b1), 409, "id_conflict");
  });

  it("404s a non-member and 401s a signed-out caller", async () => {
    const { a, stranger, p } = await world();
    const one = (await create(a, p)).body;
    expectError(await list(stranger, p), 404, "not_found");
    expectError(await create(stranger, p), 404, "not_found");
    expectError(await patch(stranger, p, one.id, { amount: { value: 1, editedAt: iso() } }), 404, "not_found");
    expectError(await del(stranger, p, one.id), 404, "not_found");
    expectError(await request(app).get(base(p)), 401, "not_signed_in");
    expectError(await request(app).post(base(p)).send(body()), 401, "not_signed_in");
  });
});
