import { useHeaderHeight } from "expo-router/react-navigation";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatPriceText, moneyOf, parsePriceText } from "../ingredients/display";
import type { Currency } from "../lib/currency";
import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { Enter } from "../ui/Enter";
import { ErrorText } from "../ui/ErrorText";
import { Screen } from "../ui/Screen";
import { Segmented } from "../ui/Segmented";
import { TextField } from "../ui/TextField";
import { afterSave, parseCupsText, previewMonthly, validateFixedCostForm, type FixedCostKindValue } from "./fixedCostForm";
import { Hint } from "./ProductBits";
import { FIXED_COST_MAX_AMOUNT, FIXED_COST_MAX_COUNT, FIXED_COST_MAX_MONTHS, FIXED_COST_NAME_MAX } from "./ProductsProvider";
import { FIXED_COST_KINDS, type FixedCost } from "./types";

const ERROR_KEYS = {
  nameEmpty: "fixedCosts.errors.nameEmpty",
  nameTooLong: "fixedCosts.errors.nameTooLong",
  nameDuplicate: "fixedCosts.errors.nameDuplicate",
  amountRequired: "fixedCosts.errors.amountRequired",
  amountTooBig: "fixedCosts.errors.amountTooBig",
  monthsRange: "fixedCosts.errors.monthsRange",
} as const;

export type FixedCostFormValues = { name: string; kind: FixedCostKindValue; amount: number; months: number | null };

export function amountText(amount: number, currency: Currency): string {
  return currency === "VND" ? formatPriceText(String(amount), currency) : String(amount / 100);
}

/** The orange result box: a label (and optional line under it) on the left, the figure on the right. */
export function ResultBox({ label, note, value }: { label: string; note?: string; value: string }) {
  const { colors, typography, radius, spacing } = useTheme();
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${label}${note ? `, ${note}` : ""}, ${value}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing[1],
        padding: spacing[2],
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.tileBorder,
        backgroundColor: colors.tile,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={[typography.bodyStrong, { color: colors.text }]}>{label}</Text>
        {note ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{note}</Text> : null}
      </View>
      <Text style={[typography.sectionTitle, { color: colors.accentStrong }]}>{value}</Text>
    </View>
  );
}

/**
 * Shared by "Khoản mới" and the edit screen (mockups 1d, 1d-prime, 1f). Errors show under their field once Lưu is
 * tapped. `onSubmit` answers whether it was saved; the screen leaves on true.
 */
export function FixedCostForm({
  initial,
  currency,
  items,
  editingId,
  cups,
  onSubmit,
  onDelete,
}: {
  initial: FixedCostFormValues | null;
  currency: Currency;
  items: readonly FixedCost[];
  editingId: string | null;
  cups: number | null;
  onSubmit: (values: FixedCostFormValues) => Promise<boolean>;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const { spacing, typography, colors } = useTheme();
  const headerHeight = useHeaderHeight();
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<FixedCostKindValue>(initial?.kind ?? "monthly");
  const [amountInput, setAmountInput] = useState(initial ? amountText(initial.amount, currency) : "");
  const [monthsInput, setMonthsInput] = useState(initial?.months ? String(initial.months) : "");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const amount = amountInput.trim() === "" ? null : parsePriceText(amountInput, currency);
  const months = kind === "oneTime" ? parseCupsText(monthsInput) : null;
  const others = items.filter((i) => i.id !== editingId).map((i) => i.name);
  const errors = validateFixedCostForm({ name, kind, amount, months }, others, {
    nameMax: FIXED_COST_NAME_MAX,
    amountMax: FIXED_COST_MAX_AMOUNT,
    monthsMax: FIXED_COST_MAX_MONTHS,
  });
  const full = editingId === null && items.length >= FIXED_COST_MAX_COUNT;
  const monthly = previewMonthly(kind, amount, months);
  const ready = Object.keys(errors).length === 0 && amount !== null;
  const after = ready && cups !== null ? afterSave(items, editingId, { kind, amount, months }, cups) : null;
  const message = (key: keyof typeof ERROR_KEYS | undefined) => (submitted && key ? t(ERROR_KEYS[key], { max: FIXED_COST_NAME_MAX }) : null);

  async function submit() {
    setSubmitted(true);
    setFailed(false);
    if (!ready || full || busy) return;
    setBusy(true);
    const ok = await onSubmit({ name: name.trim(), kind, amount, months }).catch(() => false);
    setBusy(false);
    if (!ok) setFailed(true);
  }

  return (
    <Screen edges={[]} keyboardOffset={headerHeight} footer={<Button label={t("fixedCosts.save")} loading={busy} onPress={submit} />}>
      <Enter index={0}>
        <View style={{ gap: spacing[2] }}>
          <TextField
            label={t("fixedCosts.nameLabel")}
            icon="receipt-outline"
            placeholder={t("fixedCosts.namePlaceholder")}
            autoFocus={initial === null}
            value={name}
            onChangeText={setName}
            autoCapitalize="sentences"
            editable={!busy}
            error={message(errors.name)}
          />
          <View style={{ gap: spacing[0] }}>
            <Text style={[typography.label, { color: colors.text }]}>{t("fixedCosts.kindLabel")}</Text>
            <Segmented
              accessibilityLabel={t("fixedCosts.kindLabel")}
              value={kind}
              options={FIXED_COST_KINDS.map((k) => ({ value: k, label: t(`fixedCosts.kind.${k}`) }))}
              onChange={setKind}
            />
          </View>
          <TextField
            label={t(kind === "weekly" ? "fixedCosts.amountWeeklyLabel" : "fixedCosts.amountLabel")}
            icon="cash-outline"
            keyboardType={currency === "VND" ? "number-pad" : "decimal-pad"}
            placeholder={moneyOf(0, currency)}
            value={amountInput}
            onChangeText={(v) => setAmountInput(currency === "VND" ? formatPriceText(v, currency) : v.replace(/[^\d.,]/g, ""))}
            editable={!busy}
            error={message(errors.amount)}
          />
          {kind === "oneTime" ? (
            <TextField
              label={t("fixedCosts.monthsLabel")}
              icon="calendar-outline"
              keyboardType="number-pad"
              placeholder={t("fixedCosts.monthsPlaceholder")}
              value={monthsInput}
              onChangeText={(v) => setMonthsInput(v.replace(/\D/g, ""))}
              editable={!busy}
              error={message(errors.months)}
            />
          ) : null}
          {kind !== "monthly" && monthly !== null ? (
            <ResultBox
              label={t("fixedCosts.resultLabel")}
              note={kind === "weekly" && amount !== null ? t("fixedCosts.resultWeekly", { amount: moneyOf(amount, currency) }) : undefined}
              value={moneyOf(monthly, currency)}
            />
          ) : null}
          {after && after.share !== null ? (
            <Hint>{t("fixedCosts.afterSave", { total: moneyOf(after.total, currency), share: moneyOf(after.share, currency) })}</Hint>
          ) : null}
          {submitted && full ? <ErrorText message={t("fixedCosts.errors.limitReached", { max: FIXED_COST_MAX_COUNT })} /> : null}
          {failed ? <ErrorText message={t("fixedCosts.errors.saveFailed")} /> : null}
          {onDelete ? <Button label={t("fixedCosts.deleteButton")} variant="danger" onPress={onDelete} /> : null}
        </View>
      </Enter>
    </Screen>
  );
}
