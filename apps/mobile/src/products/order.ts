// A-Z in Vietnamese collation; Array.sort is stable so equal names keep their order.
export function sortProducts<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));
}

const SIZE_RANK: Record<string, number> = { S: 0, M: 1, L: 2 };

// The size a product list row summarises: M if present, otherwise the smallest.
export function summarySize<T extends { size: string }>(sizes: readonly T[]): T | null {
  const m = sizes.find((s) => s.size === "M");
  if (m) return m;
  let best: T | null = null;
  for (const s of sizes) {
    if (best === null || (SIZE_RANK[s.size] ?? 99) < (SIZE_RANK[best.size] ?? 99)) best = s;
  }
  return best;
}
