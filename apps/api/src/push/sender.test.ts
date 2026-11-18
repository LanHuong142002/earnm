import { describe, expect, it } from "vitest";
import { createFakeSender, invalidTokensFromTickets } from "./sender.js";

describe("invalidTokensFromTickets", () => {
  it("maps DeviceNotRegistered tickets to their tokens by index", () => {
    const messages = [{ to: "a" }, { to: "b" }, { to: "c" }];
    expect(
      invalidTokensFromTickets(messages, [
        { status: "ok", id: "1" },
        { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
        { status: "error", message: "big", details: { error: "MessageTooBig" } },
      ]),
    ).toEqual(["b"]);
  });
});

describe("fake sender", () => {
  it("records messages and reports the configured tokens as invalid", async () => {
    const fake = createFakeSender(["bad"]);
    const msg = (to: string) => ({ to, title: "t", body: "b", data: {} });
    const res = await fake.send([msg("ok"), msg("bad")]);
    expect(res.invalidTokens).toEqual(["bad"]);
    expect(fake.sent.map((m) => m.to)).toEqual(["ok", "bad"]);
  });
});
