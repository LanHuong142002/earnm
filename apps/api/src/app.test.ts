import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "./http/errors.js";
import { useTestApp } from "./test/helpers.js";

describe("app foundation", () => {
  const { app } = useTestApp();

  it("GET /health returns 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("unknown route returns 404 not_found in the error shape", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
    expect(typeof res.body.error.message).toBe("string");
  });

  it("malformed JSON returns 400 invalid_json", async () => {
    const res = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });

  it("a route that throws returns 500 internal_error without a stack", async () => {
    const failing = express();
    failing.get("/boom", () => {
      throw new Error("secret query text SELECT * FROM User");
    });
    failing.use(errorHandler);
    const res = await request(failing).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("internal_error");
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("SELECT");
    expect(text).not.toContain("at ");
    expect(text).not.toContain("stack");
  });
});
