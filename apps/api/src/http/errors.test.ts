import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectError } from "../test/helpers.js";
import { errorHandler } from "./errors.js";

describe("error handler logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not log the message of an unexpected error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = express();
    app.get("/boom", () => {
      const err = new Error("Unique constraint failed on email = victim@example.com");
      (err as unknown as { code: string }).code = "P2002";
      throw err;
    });
    app.use(errorHandler);

    const res = await request(app).get("/boom");
    expectError(res, 500, "internal_error");
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("victim@example.com");
    expect(logged).toContain("Error");
    expect(logged).toContain("P2002");
    expect(logged).toContain("at ");
  });

  it("answers other body-parser client errors with 400-range bad_request and does not log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = express();
    app.use(express.json());
    app.post("/x", (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    const res = await request(app)
      .post("/x")
      .set("Content-Type", "application/json; charset=not-a-charset")
      .send("{}");
    expectError(res, 415, "bad_request");
    expect(spy).not.toHaveBeenCalled();
  });
});
