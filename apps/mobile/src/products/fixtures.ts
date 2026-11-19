import type { ExtraCost, Product, ProductSize } from "./types";

export function productSize(overrides: Partial<ProductSize> & { size: ProductSize["size"] }): ProductSize {
  return { sellingPrice: null, lines: [], extras: [], ...overrides };
}

/** A product for tests; every field can be overridden. */
export function product(overrides: Partial<Product> & { id: string }): Product {
  return {
    projectId: "p1",
    name: "Trà sữa",
    createdAt: "2026-11-10T09:00:00.000Z",
    sizes: [productSize({ size: "M" })],
    ...overrides,
  };
}

export function extraCost(overrides: Partial<ExtraCost> & { id: string }): ExtraCost {
  return { projectId: "p1", name: "Đá", amount: 500, isDefault: false, createdAt: "2026-11-10T09:00:00.000Z", ...overrides };
}
