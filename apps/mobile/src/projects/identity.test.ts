import { describe, expect, it } from "vitest";

import { projectColors } from "../theme/tokens";
import { projectColor, projectInitials } from "./identity";

describe("projectColor", () => {
  it("is stable for the same id", () => {
    expect(projectColor("abc-123")).toBe(projectColor("abc-123"));
  });
  it("always returns one of the project colours", () => {
    for (let i = 0; i < 200; i++) expect(projectColors).toContain(projectColor(`id-${i}`));
  });
  it("uses every colour across many ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(projectColor(`id-${i}`));
    expect(seen.size).toBe(projectColors.length);
  });
  it("handles an empty id", () => {
    expect(projectColors).toContain(projectColor(""));
  });
});

describe("projectInitials", () => {
  it("takes the first letters of the first two words, upper-cased", () => {
    expect(projectInitials("quán trà sữa")).toBe("QT");
  });
  it("uses one letter for a single word", () => {
    expect(projectInitials("Alpha")).toBe("A");
  });
  it("keeps Vietnamese letters with diacritics", () => {
    expect(projectInitials("Đào Ánh")).toBe("ĐÁ");
    expect(projectInitials("ơn")).toBe("Ơ");
  });
  it("ignores extra spaces and punctuation", () => {
    expect(projectInitials("  -- cafe   (mới) ")).toBe("CM");
  });
  it("falls back to a placeholder for an empty name", () => {
    expect(projectInitials("   ")).toBe("?");
  });
  it("joins a letter and its combining mark", () => {
    expect(projectInitials("école")).toBe("É");
  });
});
