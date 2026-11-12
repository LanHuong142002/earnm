import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const SECRET = "s".repeat(32);
const base = { DATABASE_URL: "postgres://x", INTERNAL_SECRET: SECRET };

function failure(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err as ConfigError;
  }
  throw new Error("expected loadConfig to throw");
}

describe("loadConfig", () => {
  it("returns the values with defaults for TRUST_PROXY and PORT", () => {
    expect(loadConfig(base)).toEqual({
      databaseUrl: "postgres://x",
      trustProxy: 0,
      internalSecret: SECRET,
      port: 3000,
      inviteInstallUrl: null,
    });
  });

  it.each([undefined, ""])("treats INVITE_INSTALL_URL %j as unset", (value) => {
    expect(loadConfig({ ...base, INVITE_INSTALL_URL: value }).inviteInstallUrl).toBeNull();
  });

  it("reads an https INVITE_INSTALL_URL", () => {
    expect(
      loadConfig({ ...base, INVITE_INSTALL_URL: "https://testflight.apple.com/join/abc" })
        .inviteInstallUrl,
    ).toBe("https://testflight.apple.com/join/abc");
  });

  it.each(["http://example.com/x", "not a url", "javascript:alert(1)", "ftp://example.com"])(
    "rejects a non-https INVITE_INSTALL_URL %j without echoing it",
    (value) => {
      const err = failure({ ...base, INVITE_INSTALL_URL: value });
      expect(err.message).toContain("INVITE_INSTALL_URL");
      expect(err.message).not.toContain(value);
    },
  );

  it("reads TRUST_PROXY and PORT when set", () => {
    const cfg = loadConfig({ ...base, TRUST_PROXY: "2", PORT: "8080" });
    expect(cfg.trustProxy).toBe(2);
    expect(cfg.port).toBe(8080);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(failure({ INTERNAL_SECRET: SECRET }).message).toBe("DATABASE_URL is not set.");
  });

  it("rejects a bad TRUST_PROXY", () => {
    expect(failure({ ...base, TRUST_PROXY: "-1" }).message).toBe(
      "TRUST_PROXY must be a non-negative integer (the number of proxy hops).",
    );
  });

  it.each([undefined, ""])("rejects a missing INTERNAL_SECRET (%j)", (value) => {
    expect(failure({ ...base, INTERNAL_SECRET: value }).message).toContain("INTERNAL_SECRET");
  });

  it("rejects a 31-character INTERNAL_SECRET without echoing it", () => {
    const short = "k".repeat(31);
    const err = failure({ ...base, INTERNAL_SECRET: short });
    expect(err.message).toContain("INTERNAL_SECRET");
    expect(err.message).toContain("32");
    expect(err.message).not.toContain(short);
  });

  it.each([
    ["leading space", ` ${"k".repeat(40)}`],
    ["trailing space", `${"k".repeat(40)} `],
    ["trailing newline", `${"k".repeat(40)}
`],
    ["inner space", `${"k".repeat(20)} ${"k".repeat(20)}`],
  ])("rejects an INTERNAL_SECRET with whitespace (%s) without echoing it", (_label, value) => {
    const err = failure({ ...base, INTERNAL_SECRET: value });
    expect(err.message).toContain("INTERNAL_SECRET");
    expect(err.message).toContain("spaces or line breaks");
    expect(err.message).not.toContain("kkkk");
  });

  it("accepts a 32-character INTERNAL_SECRET", () => {
    expect(loadConfig(base).internalSecret).toBe(SECRET);
  });
});
