import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

// Fixed costs (#14, AC 14): every fixedCosts.* key the source uses exists in both languages, and the whole section matches.
describe("fixed costs translations", () => {
  const read = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return read(path);
      return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [readFileSync(path, "utf8")] : [];
    });
  const used = new Set<string>();
  for (const source of read(join(__dirname, ".."))) {
    for (const match of source.matchAll(/["'`](fixedCosts\.[A-Za-z0-9_.]+)["'`]/g)) used.add(match[1]!);
  }
  const has = (tree: unknown, path: string) => {
    const keys = normalize(keyPaths(tree));
    return keys.includes(path) || keys.includes(`${path}_plural`);
  };

  it("uses at least the known keys", () => {
    expect(used.size).toBeGreaterThan(20);
  });
  it.each([...used])("has %s in vi.json and en.json", (key) => {
    expect(has(vi, key), `missing in vi.json: ${key}`).toBe(true);
    expect(has(en, key), `missing in en.json: ${key}`).toBe(true);
  });
  it("has the dynamic kind and error keys in both", () => {
    for (const k of ["monthly", "weekly", "oneTime"]) {
      expect(has(vi, `fixedCosts.kind.${k}`) && has(en, `fixedCosts.kind.${k}`)).toBe(true);
    }
    for (const k of ["nameEmpty", "nameTooLong", "nameDuplicate", "amountRequired", "amountTooBig", "monthsRange", "cupsRange", "limitReached", "saveFailed"]) {
      expect(has(vi, `fixedCosts.errors.${k}`) && has(en, `fixedCosts.errors.${k}`)).toBe(true);
    }
  });
});
