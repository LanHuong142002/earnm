import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSignedInUser, prisma, useTestApp } from "../test/helpers.js";
import { deliverPushes } from "./deliver.js";
import { createFakeSender, type PushMessage } from "./sender.js";

const message = (to: string): PushMessage => ({ to, title: "t", body: "b", data: {} });

describe("deliverPushes", () => {
  const { clock } = useTestApp();

  async function tokens(...names: string[]) {
    const user = await createSignedInUser(clock);
    const out = names.map((n) => `ExponentPushToken[${n}-${randomUUID()}]`);
    for (const token of out) await prisma.devicePushToken.create({ data: { token, userId: user.id } });
    return out;
  }

  it("reports each message as delivered or failed, by index", async () => {
    const [ok, failing] = await tokens("ok", "failing");
    const sender = createFakeSender();
    sender.failing.add(failing!);

    const result = await deliverPushes(prisma, sender, [message(ok!), message(failing!)]);

    expect(result.delivered).toEqual([true, false]);
    expect(result.invalidTokens).toEqual([]);
    // A failing token is not gone: it stays for a retry.
    expect(await prisma.devicePushToken.count({ where: { token: { in: [ok!, failing!] } } })).toBe(2);
  });

  it("deletes the tokens the sender says are invalid, and reports them undelivered", async () => {
    const [ok, gone] = await tokens("ok", "gone");
    const sender = createFakeSender([gone!]);

    const result = await deliverPushes(prisma, sender, [message(ok!), message(gone!)]);

    expect(result.delivered).toEqual([true, false]);
    expect(result.invalidTokens).toEqual([gone]);
    expect((await prisma.devicePushToken.findMany({ where: { token: { in: [ok!, gone!] } } })).map((r) => r.token)).toEqual([ok]);
  });

  it("does nothing when there are no messages", async () => {
    const sender = createFakeSender();
    const send = vi.spyOn(sender, "send");

    const result = await deliverPushes(prisma, sender, []);

    expect(result).toEqual({ delivered: [], invalidTokens: [] });
    expect(send).not.toHaveBeenCalled();
  });

  it("delivers nothing and deletes nothing when the sender throws", async () => {
    const [token] = await tokens("t");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sender = { send: async () => Promise.reject(new Error("down")) };

    const result = await deliverPushes(prisma, sender, [message(token!)]);

    expect(result.delivered).toEqual([false]);
    expect(await prisma.devicePushToken.count({ where: { token: token! } })).toBe(1);
    error.mockRestore();
  });
});
