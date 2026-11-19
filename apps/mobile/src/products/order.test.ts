import { describe, expect, it } from "vitest";

import { sortProducts, summarySize } from "./order";

describe("sortProducts", () => {
  it("sorts A-Z with Vietnamese collation without mutating", () => {
    const input = ["Trà sữa", "Đá xay", "Cà phê", "Ăn vặt"].map((name) => ({ name }));
    expect(sortProducts(input).map((p) => p.name)).toEqual(["Ăn vặt", "Cà phê", "Đá xay", "Trà sữa"]);
    expect(input[0].name).toBe("Trà sữa");
  });
});

describe("summarySize", () => {
  it("prefers M", () => {
    expect(summarySize([{ size: "L" }, { size: "M" }, { size: "S" }])?.size).toBe("M");
  });
  it("falls back to the smallest", () => {
    expect(summarySize([{ size: "L" }, { size: "S" }])?.size).toBe("S");
    expect(summarySize([{ size: "L" }])?.size).toBe("L");
  });
  it("is null when empty", () => {
    expect(summarySize([])).toBeNull();
  });
});
