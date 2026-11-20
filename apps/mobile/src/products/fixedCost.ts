export type FixedCostInput = {
  kind: "monthly" | "weekly" | "oneTime";
  amount: number; // integer, smallest currency unit
  months: number | null;
};

// Round half up to an integer of the smallest unit.
const roundHalfUp = (value: number): number => Math.floor(value + 0.5);

export function monthlyAmount(item: FixedCostInput): number {
  switch (item.kind) {
    case "monthly":
      return item.amount;
    case "weekly":
      return roundHalfUp((item.amount * 52) / 12);
    case "oneTime":
      return item.months && item.months > 0 ? roundHalfUp(item.amount / item.months) : 0;
  }
}

export function fixedTotal(items: readonly FixedCostInput[]): number {
  return items.reduce((sum, item) => sum + monthlyAmount(item), 0);
}

// Fixed cost carried by each cup; null when it can't be worked out.
export function perCupShare(total: number, cups: number | null): number | null {
  if (cups === null || !(cups > 0) || total === 0) return null;
  return roundHalfUp(total / cups);
}

export function fullCost(sizeCost: number, share: number | null): number {
  return sizeCost + (share ?? 0);
}

/** The kind and months to queue for an edit: months always go with a move to one-time, and never with another kind. */
export function kindMonthsChanges(
  current: Pick<FixedCostInput, "kind" | "months">,
  kind: FixedCostInput["kind"],
  months: number | null,
): { kind?: FixedCostInput["kind"]; months?: number | null } {
  const changed: { kind?: FixedCostInput["kind"]; months?: number | null } = {};
  if (kind !== current.kind) changed.kind = kind;
  if (kind === "oneTime" && (kind !== current.kind || months !== current.months)) changed.months = months;
  return changed;
}
