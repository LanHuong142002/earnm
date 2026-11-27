import type { Draft, DraftLineRow } from "./types";

export function draftLine(overrides: Partial<DraftLineRow> & { id: string }): DraftLineRow {
  return {
    kind: "existing",
    ingredientId: "g1",
    newName: null,
    newKind: null,
    purchaseQty: null,
    purchasePrice: null,
    amount: 5,
    ...overrides,
  };
}

/** A draft for tests; every field can be overridden. */
export function draft(overrides: Partial<Draft> & { id: string }): Draft {
  return {
    projectId: "p1",
    name: "Trà vải hoa hồng",
    sizes: ["M"],
    expectedPrice: null,
    note: "",
    status: "working",
    productId: null,
    convertedAt: null,
    createdAt: "2026-11-10T09:00:00.000Z",
    lines: [],
    ideaId: null,
    idea: null,
    photoCount: 0,
    ...overrides,
  };
}
