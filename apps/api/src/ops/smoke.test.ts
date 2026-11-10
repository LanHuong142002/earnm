import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { prisma, useTestApp } from "../test/helpers.js";
import { runSmoke } from "./smoke.js";

const SECRET = "fake-smoke-secret-AAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_SECRET = "fake-smoke-secret-BBBBBBBBBBBBBBBBBBBBBBBB";

const servers: Server[] = [];

async function start(internalSecret: string): Promise<string> {
  const app = createApp({ prisma, now: () => new Date(), internalSecret });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("runSmoke", () => {
  useTestApp();

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  it("passes all three checks with the right secret", async () => {
    const baseUrl = await start(SECRET);
    const results = await runSmoke({ baseUrl, secret: SECRET });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("fails the secret check with a different secret and leaks neither secret", async () => {
    const baseUrl = await start(SECRET);
    const results = await runSmoke({ baseUrl, secret: OTHER_SECRET });
    expect(results).toHaveLength(3);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(results[2]?.ok).toBe(false);
    const text = JSON.stringify(results);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(OTHER_SECRET);
  });

  it("runs only two checks without a secret", async () => {
    const baseUrl = await start(SECRET);
    const results = await runSmoke({ baseUrl });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("fails the health check when the connection cannot be made", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const results = await runSmoke({ baseUrl: "http://127.0.0.1:1", fetch: failing });
    expect(results[0]?.name).toBe("health");
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.detail).toContain("could not connect");
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it("refuses to send a secret over non-loopback http and makes no request", async () => {
    let calls = 0;
    const spy = (async () => {
      calls++;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const results = await runSmoke({ baseUrl: "http://example.com", secret: SECRET, fetch: spy });
    expect(calls).toBe(0);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("secure-url");
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.detail).toContain("https");
    expect(JSON.stringify(results)).not.toContain(SECRET);
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "allows a secret over loopback http (%s)",
    async (baseUrl) => {
      const urls: string[] = [];
      const spy = (async (url: string) => {
        urls.push(url);
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch;
      const results = await runSmoke({ baseUrl, secret: SECRET, fetch: spy });
      expect(urls).toHaveLength(3);
      expect(results.some((r) => r.name === "secure-url")).toBe(false);
    },
  );

  it("allows non-loopback http when no secret is given", async () => {
    const urls: string[] = [];
    const spy = (async (url: string) => {
      urls.push(url);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const results = await runSmoke({ baseUrl: "http://example.com", fetch: spy });
    expect(urls).toHaveLength(2);
    expect(results.some((r) => r.name === "secure-url")).toBe(false);
  });

  it("allows a secret over https", async () => {
    const urls: string[] = [];
    const spy = (async (url: string) => {
      urls.push(url);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await runSmoke({ baseUrl: "https://example.com", secret: SECRET, fetch: spy });
    expect(urls).toHaveLength(3);
  });
});
