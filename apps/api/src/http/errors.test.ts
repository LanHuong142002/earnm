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
});
