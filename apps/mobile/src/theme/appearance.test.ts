import { describe, expect, it } from "vitest";

import { createMemoryStore } from "../sync/storage";
import { readAppearance, schemeOverride, writeAppearance } from "./appearance";

describe("appearance", () => {
  it("reads system when nothing is stored", async () => {
    expect(await readAppearance(createMemoryStore())).toBe("system");
  });

  it("round-trips each choice under appearance.v1", async () => {
    const store = createMemoryStore();
    for (const choice of ["light", "dark", "system"] as const) {
      await writeAppearance(store, choice);
      expect(await readAppearance(store)).toBe(choice);
    }
    await writeAppearance(store, "dark");
    expect(await store.getJSON("appearance.v1")).toBe("dark");
  });

  it("reads an unknown value as system", async () => {
    const store = createMemoryStore();
    await store.setJSON("appearance.v1", "sepia");
    expect(await readAppearance(store)).toBe("system");
    await store.setJSON("appearance.v1", 3);
    expect(await readAppearance(store)).toBe("system");
  });

  it("reads system when the store throws", async () => {
    const store = {
      ...createMemoryStore(),
      getJSON: () => Promise.reject(new Error("boom")),
    };
    expect(await readAppearance(store)).toBe("system");
  });

  it("maps system to unspecified", () => {
    expect(schemeOverride("system")).toBe("unspecified");
    expect(schemeOverride("dark")).toBe("dark");
    expect(schemeOverride("light")).toBe("light");
  });
});
