import { unitCost } from "../ingredients/cost";

type CostIngredient = { purchase: { quantity: number; price: number } };
type Lookup<I> = Readonly<Record<string, I | undefined>>;

// Cost of `amount` base units, as a whole minor unit.
export function lineCost(ingredient: CostIngredient, amount: number): number {
  const unit = unitCost(ingredient.purchase.price, ingredient.purchase.quantity);
  if (unit === null || !Number.isFinite(amount)) return 0;
  return Math.round(unit * amount);
}

// Ticked ingredient lines plus ticked extras; lines whose ingredient is gone count 0.
export function sizeCost(
  lines: readonly { ingredientId: string; amount: number; included: boolean }[],
  ingredients: Lookup<CostIngredient>,
  extras: readonly { amount: number; included: boolean }[],
): number {
  let total = 0;
  for (const line of lines) {
    const ingredient = ingredients[line.ingredientId];
    if (line.included && ingredient) total += lineCost(ingredient, line.amount);
  }
  for (const extra of extras) if (extra.included) total += extra.amount;
  return total;
}

export function profit(price: number | null, cost: number): number | null {
  return price === null ? null : price - cost;
}

export function marginPct(profitAmount: number, price: number | null): number | null {
  if (price === null || price <= 0) return null;
  return Math.round((profitAmount / price) * 100);
}

// Price that hits the target margin, rounded UP to 1000 (VND) or 10 cents (USD).
export function hintPrice(cost: number, targetPct: number, currency: "VND" | "USD"): number | null {
  if (!Number.isFinite(cost) || !Number.isFinite(targetPct) || targetPct >= 100) return null;
  const step = currency === "VND" ? 1000 : 10;
  const raw = (cost * 100) / (100 - targetPct);
  return Math.ceil(raw / step - 1e-9) * step;
}

// The most recent current price entry among the ingredients a product uses.
export function latestPriceUpdate(
  lines: readonly { ingredientId: string }[],
  ingredients: Lookup<{ name: string; prices: readonly { recordedAt: string }[] }>,
): { ingredientName: string; date: string } | null {
  let best: { ingredientName: string; date: string } | null = null;
  for (const line of lines) {
    const ingredient = ingredients[line.ingredientId];
    const date = ingredient?.prices[0]?.recordedAt;
    if (!ingredient || !date) continue;
    if (best === null || Date.parse(date) > Date.parse(best.date)) best = { ingredientName: ingredient.name, date };
  }
  return best;
}
