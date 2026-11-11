import { describe, expect, it } from "vitest";

import { formatMoney } from "./currency";

describe("formatMoney", () => {
  it("formats VND with dot grouping and a trailing dong sign", () => {
    expect(formatMoney(1250000, "VND")).toBe("1.250.000 ₫");
  });

  it("formats USD with comma grouping, two decimals and a leading $", () => {
    expect(formatMoney(1250.5, "USD")).toBe("$1,250.50");
  });

  it("formats zero", () => {
    expect(formatMoney(0, "VND")).toBe("0 ₫");
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });

  it("formats values under 1000 without grouping", () => {
    expect(formatMoney(999, "VND")).toBe("999 ₫");
    expect(formatMoney(5, "USD")).toBe("$5.00");
  });

  it("rounds VND to a whole number", () => {
    expect(formatMoney(1999.6, "VND")).toBe("2.000 ₫");
  });

  it("rounds USD to two decimals", () => {
    expect(formatMoney(1.239, "USD")).toBe("$1.24");
    expect(formatMoney(0.999, "USD")).toBe("$1.00");
  });

  it("prefixes negatives with a minus sign", () => {
    expect(formatMoney(-1000, "VND")).toBe("-1.000 ₫");
    expect(formatMoney(-5, "USD")).toBe("-$5.00");
  });

  it("does not render negative zero", () => {
    expect(formatMoney(-0.2, "VND")).toBe("0 ₫");
    expect(formatMoney(-0.001, "USD")).toBe("$0.00");
  });
});
