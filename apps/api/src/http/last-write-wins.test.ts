import { describe, expect, it } from "vitest";
import { applyLastWriteWins } from "./last-write-wins.js";

// A fake `write` that only records what it was asked to do: no database needed.
function recorder() {
  const calls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const write = async (where: Record<string, unknown>, data: Record<string, unknown>) => {
    calls.push({ where, data });
  };
  return { calls, write };
}

const now = new Date("2026-11-11T10:00:00Z");

describe("applyLastWriteWins", () => {
  it("writes each sent field only where its stored time is older", async () => {
    const { calls, write } = recorder();
    const at = new Date("2026-11-11T09:00:00Z");

    await applyLastWriteWins({ name: { value: "Trà Mây", editedAt: at } }, now, write);

    expect(calls).toEqual([
      { where: { nameEditedAt: { lt: at } }, data: { name: "Trà Mây", nameEditedAt: at } },
    ]);
  });

  it("caps an edit time in the future at now", async () => {
    const { calls, write } = recorder();
    const future = new Date("2027-01-01T00:00:00Z");

    await applyLastWriteWins({ name: { value: "X", editedAt: future } }, now, write);

    expect(calls[0]!.data["nameEditedAt"]).toEqual(now);
    expect(calls[0]!.where).toEqual({ nameEditedAt: { lt: now } });
  });

  it("writes every field with its own time and skips missing ones", async () => {
    const { calls, write } = recorder();
    const t1 = new Date("2026-11-11T08:00:00Z");
    const t2 = new Date("2026-11-11T09:00:00Z");

    await applyLastWriteWins(
      { name: { value: "N", editedAt: t1 }, description: undefined, currency: { value: "USD", editedAt: t2 } },
      now,
      write,
    );

    expect(calls.map((c) => c.data)).toEqual([
      { name: "N", nameEditedAt: t1 },
      { currency: "USD", currencyEditedAt: t2 },
    ]);
  });
});
