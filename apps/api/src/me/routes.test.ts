import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { hashPassword } from "../auth/password.js";
import { createSession } from "../auth/sessions.js";
import { errorHandler, notFoundHandler } from "../http/errors.js";
import { createClock, prisma, useTestApp } from "../test/helpers.js";
import { createMeRouter } from "./routes.js";

describe("/me", () => {
  useTestApp();
  const clock = createClock();
  const app = express();
  app.use(express.json());
  app.use("/me", createMeRouter({ prisma, now: clock.now }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  async function signedInUser(): Promise<{ id: string; token: string }> {
    const user = await prisma.user.create({
      data: {
        email: "a@example.com",
        passwordHash: await hashPassword("correct horse battery"),
        displayName: "Anna",
      },
    });
    const token = await createSession(prisma, user.id, clock.now());
    return { id: user.id, token };
  }

  const auth = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];

  it("a new user's language is null", async () => {
    const { token } = await signedInUser();
    const res = await request(app).get("/me").set(...auth(token));
    expect(res.status).toBe(200);
    expect(res.body.language).toBeNull();
  });

  it("GET returns exactly four keys and no secrets", async () => {
    const { id, token } = await signedInUser();
    const res = await request(app).get("/me").set(...auth(token));
    expect(Object.keys(res.body).sort()).toEqual(["displayName", "email", "id", "language"]);
    expect(res.body).toMatchObject({ id, email: "a@example.com", displayName: "Anna" });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|session/i);
  });

  it("PATCH saves en and a later GET returns it", async () => {
    const { token } = await signedInUser();
    const patch = await request(app).patch("/me").set(...auth(token)).send({ language: "en" });
    expect(patch.status).toBe(200);
    expect(Object.keys(patch.body).sort()).toEqual(["displayName", "email", "id", "language"]);
    expect(patch.body.language).toBe("en");
    const get = await request(app).get("/me").set(...auth(token));
    expect(get.body.language).toBe("en");
  });

  it("rejects an invalid language and unknown fields with 400", async () => {
    const { token } = await signedInUser();
    for (const body of [{ language: "fr" }, {}, { language: "en", displayName: "x" }]) {
      const res = await request(app).patch("/me").set(...auth(token)).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("validation_failed");
    }
  });

  it("returns 401 on both routes without a token", async () => {
    const get = await request(app).get("/me");
    expect(get.status).toBe(401);
    expect(get.body.error.code).toBe("not_signed_in");
    const patch = await request(app).patch("/me").send({ language: "en" });
    expect(patch.status).toBe(401);
  });
});
