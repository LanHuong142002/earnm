import { monthlyAmount, fixedTotal, perCupShare } from "./fixedCost";
import { validateName, type NameError } from "./view";

export type FixedCostKindValue = "monthly" | "weekly" | "oneTime";
export const EXPECTED_CUPS_MAX = 1_000_000;

export type FixedCostFormErrors = {
  name?: NameError;
  amount?: "amountRequired" | "amountTooBig";
  months?: "monthsRange";
};

type Limits = { nameMax: number; amountMax: number; monthsMax: number };

/** Field checks for the fixed cost form, so each message can sit under its own field (mockup 1f). */
export function validateFixedCostForm(
  form: { name: string; kind: FixedCostKindValue; amount: number | null; months: number | null },
  otherNames: readonly string[],
  limits: Limits,
): FixedCostFormErrors {
  const errors: FixedCostFormErrors = {};
  const name = validateName(form.name, otherNames, limits.nameMax);
  if (name) errors.name = name;
  if (form.amount === null || !(form.amount > 0)) errors.amount = "amountRequired";
  else if (form.amount > limits.amountMax) errors.amount = "amountTooBig";
  if (form.kind === "oneTime" && (form.months === null || !Number.isInteger(form.months) || form.months < 1 || form.months > limits.monthsMax)) {
    errors.months = "monthsRange";
  }
  return errors;
}

/** The live "Mỗi tháng" figure; null until there is enough typed. */
export function previewMonthly(kind: FixedCostKindValue, amount: number | null, months: number | null): number | null {
  if (amount === null || !(amount > 0)) return null;
  if (kind === "oneTime" && (months === null || !(months > 0))) return null;
  return monthlyAmount({ kind, amount, months: kind === "oneTime" ? months : null });
}

type Listed = { id: string; kind: FixedCostKindValue; amount: number; months: number | null };

/** The total and per-cup share once `draft` is saved: it replaces item `editingId`, or is added when that is null. */
export function afterSave(
  items: readonly Listed[],
  editingId: string | null,
  draft: { kind: FixedCostKindValue; amount: number; months: number | null },
  cups: number | null,
): { total: number; share: number | null } {
  const total = fixedTotal(items.filter((i) => i.id !== editingId)) + monthlyAmount(draft);
  return { total, share: perCupShare(total, cups) };
}

/** The total and per-cup share once item `id` is deleted. */
export function afterDelete(items: readonly Listed[], id: string, cups: number | null): { total: number; share: number | null } {
  const total = fixedTotal(items.filter((i) => i.id !== id));
  return { total, share: perCupShare(total, cups) };
}

/** The cups field: digits only (dots are thousands marks); empty is null. */
export function parseCupsText(text: string): number | null {
  const digits = text.replace(/\D/g, "");
  return digits === "" ? null : Number(digits);
}

/** Cups a day over a 30-day month, rounded. */
export function cupsPerDay(cups: number): number {
  return Math.round(cups / 30);
}
