// A-Z in Vietnamese collation; Array.sort is stable so equal names keep their order.
export function sortIngredients<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));
}
