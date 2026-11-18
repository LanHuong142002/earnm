import { describe, expect, it } from "vitest";

import { createSignOutCleanups } from "./sign-out-cleanups";

describe("sign-out cleanups", () => {
  it("runs every registered cleanup", async () => {
    const reg = createSignOutCleanups();
    const ran: string[] = [];
    reg.register(async () => void ran.push("tasks"));
    reg.register(async () => void ran.push("projects"));
    await reg.runAll();
    expect(ran).toEqual(["tasks", "projects"]);
  });

  it("does not run an unregistered cleanup", async () => {
    const reg = createSignOutCleanups();
    const ran: string[] = [];
    const off = reg.register(async () => void ran.push("a"));
    reg.register(async () => void ran.push("b"));
    off();
    await reg.runAll();
    expect(ran).toEqual(["b"]);
  });

  it("keeps going when one cleanup fails", async () => {
    const reg = createSignOutCleanups();
    const ran: string[] = [];
    reg.register(async () => {
      throw new Error("x");
    });
    reg.register(async () => void ran.push("b"));
    await reg.runAll();
    expect(ran).toEqual(["b"]);
  });
});
