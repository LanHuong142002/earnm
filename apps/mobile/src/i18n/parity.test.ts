import { describe, expect, it } from "vitest";

import en from "./en.json";
import vi from "./vi.json";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

// Vietnamese has no plural forms, so it only needs the "_other" form of a plural pair.
const normalize = (keys: string[]) => keys.map((k) => k.replace(/_(one|other)$/, "_plural"));

describe("translation key parity", () => {
  const enKeys = new Set(normalize(keyPaths(en)));
  const viKeys = new Set(normalize(keyPaths(vi)));

  it("has every English key in Vietnamese", () => {
    const missing = [...enKeys].filter((k) => !viKeys.has(k));
    expect(missing, `missing in vi.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("has every Vietnamese key in English", () => {
    const missing = [...viKeys].filter((k) => !enKeys.has(k));
    expect(missing, `missing in en.json: ${missing.join(", ")}`).toEqual([]);
  });
});
