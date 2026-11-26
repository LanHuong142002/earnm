import { describe, expect, it } from "vitest";

import { scrollTargetY } from "./scrollIntoView";

const base = { viewportHeight: 400, margin: 16 };

describe("scrollTargetY", () => {
  it("scrolls down so the bottom sits above the fold with the margin", () => {
    // visible 0..400, target 500..580 -> bottom 580 + 16 - 400 = 196
    expect(scrollTargetY({ ...base, targetY: 500, targetHeight: 80, currentY: 0 })).toBe(196);
  });

  it("returns null when already fully visible", () => {
    expect(scrollTargetY({ ...base, targetY: 100, targetHeight: 80, currentY: 0 })).toBeNull();
  });

  it("aligns the top (minus margin, not below 0) when taller than the viewport", () => {
    expect(scrollTargetY({ ...base, targetY: 500, targetHeight: 600, currentY: 0 })).toBe(484);
    expect(scrollTargetY({ ...base, targetY: 5, targetHeight: 600, currentY: 300 })).toBe(0);
  });

  it("scrolls up when the target is above the viewport", () => {
    expect(scrollTargetY({ ...base, targetY: 100, targetHeight: 80, currentY: 300 })).toBe(84);
    expect(scrollTargetY({ ...base, targetY: 4, targetHeight: 80, currentY: 300 })).toBe(0);
  });

  it("never scrolls past the target's top when margin would push it off", () => {
    // bottom 390+16-... target 380..460, viewport 100 -> needs 376 but top-margin is 364 -> capped
    expect(
      scrollTargetY({ targetY: 380, targetHeight: 80, viewportHeight: 100, currentY: 0, margin: 16 }),
    ).toBe(364);
  });

  it("handles a target near the end of content", () => {
    expect(scrollTargetY({ ...base, targetY: 1000, targetHeight: 50, currentY: 600 })).toBe(666);
  });
});
