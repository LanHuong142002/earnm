import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler, notFoundHandler } from "../http/errors.js";
import { createClock, prisma, useTestApp } from "../test/helpers.js";
import { deriveInviteKey, hashCode } from "./code.js";
import { createInvitePageRouter } from "./page-routes.js";

const DAY = 24 * 3600 * 1000;
const inviteKey = deriveInviteKey("test-internal-secret");

describe("GET /i/:code", () => {
  useTestApp();
  const clock = createClock();

  function makeApp(installUrl: string | null = null) {
    const app = express();
    app.use(createInvitePageRouter({ prisma, now: clock.now, inviteKey, installUrl }));
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
  }

  async function seed(opts: {
    projectName?: string;
    inviterName?: string | null;
    code: string;
    expiresAt?: Date;
    usedAt?: Date;
    revokedAt?: Date;
  }) {
    const inviter =
      opts.inviterName === null
        ? null
        : await prisma.user.create({
            data: {
              email: `i-${randomUUID()}@example.com`,
              passwordHash: "x",
              displayName: opts.inviterName ?? "Lan",
            },
          });
    const project = await prisma.project.create({
      data: {
        id: randomUUID(),
        nameEditedAt: clock.now(),
        descriptionEditedAt: clock.now(),
        currencyEditedAt: clock.now(),
        name: opts.projectName ?? "Secret Project",
        currency: "VND",
      },
    });
    await prisma.invite.create({
      data: {
        projectId: project.id,
        codeHash: hashCode(opts.code, inviteKey),
        createdById: inviter?.id ?? null,
        createdAt: clock.now(),
        expiresAt: opts.expiresAt ?? new Date(clock.now().getTime() + DAY),
        usedAt: opts.usedAt ?? null,
        revokedAt: opts.revokedAt ?? null,
      },
    });
  }

  function expectHeaders(res: request.Response) {
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  }

  it("AC8: renders a pending invite with escaped names and the headers", async () => {
    await seed({ code: "ABCD2345", projectName: "<script>alert(1)</script>" });
    const res = await request(makeApp()).get("/i/abcd-2345");
    expect(res.status).toBe(200);
    expectHeaders(res);
    expect(res.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(res.text).not.toContain("<script");
    expect(res.text).toContain("Lan");
    expect(res.text).toContain("ABCD-2345");
    expect(res.text).toContain("Tham gia bằng mã");
  });

  it("falls back when the inviter was deleted", async () => {
    await seed({ code: "ABCD2345", inviterName: null });
    const res = await request(makeApp()).get("/i/ABCD2345").set("Accept-Language", "en");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Someone");
  });

  it("AC8: unknown, malformed, used, revoked and expired give one identical 404 body", async () => {
    const past = new Date(clock.now().getTime() - 1000);
    await seed({ code: "USED2345", usedAt: past });
    await seed({ code: "REVK2345", revokedAt: past });
    await seed({ code: "EXPR2345", expiresAt: past });
    const app = makeApp();
    const bodies: string[] = [];
    for (const code of ["ZZZZ2345", "bad!", "USED2345", "REVK2345", "EXPR2345"]) {
      const res = await request(app).get(`/i/${code}`);
      expect(res.status).toBe(404);
      expectHeaders(res);
      expect(res.text).not.toContain("Secret Project");
      bodies.push(res.text);
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("AC9: language follows Accept-Language", async () => {
    await seed({ code: "ABCD2345" });
    const app = makeApp();
    const en = await request(app).get("/i/ABCD2345").set("Accept-Language", "en-US,en;q=0.9");
    expect(en.text).toContain('<html lang="en">');
    const vi = await request(app).get("/i/ABCD2345").set("Accept-Language", "vi");
    expect(vi.text).toContain('<html lang="vi">');
    const none = await request(app).get("/i/ABCD2345");
    expect(none.text).toContain('<html lang="vi">');
    const missEn = await request(app).get("/i/NOPE2345").set("Accept-Language", "en");
    expect(missEn.status).toBe(404);
    expect(missEn.text).toContain('<html lang="en">');
  });

  it("AC10: links the install URL only when configured", async () => {
    await seed({ code: "ABCD2345" });
    const set = await request(makeApp("https://example.com/get")).get("/i/ABCD2345");
    expect(set.text).toContain('href="https://example.com/get"');
    const unset = await request(makeApp(null)).get("/i/ABCD2345");
    expect(unset.text).not.toContain("<a ");
  });

  it("AC11: the 61st lookup in the window is 429 with the generic page, then recovers", async () => {
    await seed({ code: "ABCD2345" });
    const app = makeApp();
    for (let i = 0; i < 60; i++) {
      const res = await request(app).get("/i/ABCD2345");
      expect(res.status).toBe(200);
    }
    const limited = await request(app).get("/i/ABCD2345");
    expect(limited.status).toBe(429);
    expectHeaders(limited);
    expect(limited.text).not.toContain("Secret Project");
    const generic = await request(app).get("/i/ZZZZ2345");
    expect(generic.status).toBe(429);
    clock.advanceMs(15 * 60 * 1000);
    expect((await request(app).get("/i/ABCD2345")).status).toBe(200);
  });
});
