import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";
import { colors, labelColors, type LabelColour } from "./tokens";

const keys = Object.keys(labelColors.light) as LabelColour[];

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });
  it("is 1 for identical colours and symmetric", () => {
    expect(contrastRatio("#F4511E", "#F4511E")).toBeCloseTo(1, 5);
    expect(contrastRatio("#123456", "#ABCDEF")).toBeCloseTo(contrastRatio("#ABCDEF", "#123456"), 10);
  });
});

describe("label colours", () => {
  it("has the 8 keys in both schemes", () => {
    expect(keys).toEqual(["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple"]);
    expect(Object.keys(labelColors.dark)).toEqual(keys);
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const key of keys) {
      const { bg, text } = labelColors[scheme][key];
      it(`${scheme} ${key} text on bg is at least 4.5:1`, () => {
        expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
      });
      it(`${scheme} ${key} never uses the accent`, () => {
        const accent = colors[scheme].accent.toLowerCase();
        expect(bg.toLowerCase()).not.toBe(accent);
        expect(text.toLowerCase()).not.toBe(accent);
        expect(bg.toLowerCase()).not.toBe("#f4511e");
        expect(text.toLowerCase()).not.toBe("#f4511e");
      });
    }
  }
});
