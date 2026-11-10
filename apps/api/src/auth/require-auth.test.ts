import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../http/errors.js";
import { prisma, useTestApp } from "../test/helpers.js";
import { requireAuth } from "./require-auth.js";
import { createSession } from "./sessions.js";

const DAY = 24 * 60 * 60 * 1000;

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: "a@example.com",
      passwordHash: "placeholder-hash",
      displayName: "Test",
    },
  });
  return user.id;
}

describe("requireAuth", () => {
  const { clock } = useTestApp();

  function buildApp(): express.Express {
    const app = express();
    app.get("/me", requireAuth({ prisma, now: clock.now }), (_req, res) => {
      res.json(res.locals["auth"]);
    });
    app.use(errorHandler);
    return app;
  }

  const notSignedIn = {
    error: { code: "not_signed_in", message: "Not signed in." },
  };

  it("rejects a missing header", async () => {
    const res = await request(buildApp()).get("/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual(notSignedIn);
  });

  it("rejects a random token and malformed headers", async () => {
    const app = buildApp();
    for (const h of ["Bearer abc123", "Basic abc", "Bearer", `Bearer ${"a".repeat(201)}`]) {
      const res = await request(app).get("/me").set("Authorization", h);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(notSignedIn);
    }
  });

  it("rejects an expired token", async () => {
    const userId = await makeUser();
    const token = await createSession(prisma, userId, clock.now());
    clock.advanceMs(90 * DAY);
    const res = await request(buildApp())
      .get("/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(notSignedIn);
  });

  it("passes a valid token with the right userId", async () => {
    const userId = await makeUser();
    const token = await createSession(prisma, userId, clock.now());
    const res = await request(buildApp())
      .get("/me")
      .set("authorization", `bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userId);
    expect(typeof res.body.sessionId).toBe("string");
  });
});
