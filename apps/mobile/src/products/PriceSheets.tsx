import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatPriceText, moneyOf, parsePriceText } from "../ingredients/display";
import type { Currency } from "../lib/currency";
import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { TextField } from "../ui/TextField";
import { hintPrice, marginPct } from "./cost";
import { Hint, SummaryRow } from "./ProductBits";
import { validMoney } from "./recipeEdit";
import { SheetModal } from "./SheetModal";
import { parseTarget } from "./view";

const TOKEN = "\u0001";

/** "Muốn lãi 65%: bán từ 32.000 ₫" as one small line; tapping it changes the target margin. Nothing when there is no cost yet. */
export function PriceHint({ cost, target, currency, onPress }: { cost: number; target: number; currency: Currency; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors, typography, layout } = useTheme();
  const hint = cost > 0 ? hintPrice(cost, target, currency) : null;
  if (hint === null) return null;
  const price = moneyOf(hint, currency);
  const [before, after = ""] = t("products.hint", { pct: TOKEN, price }).split(TOKEN);
  // The "%" after the number belongs to the tappable part.
  const sign = after.startsWith("%") ? "%" : "";
  return (
    <Text
      accessibilityRole="button"
      accessibilityLabel={t("products.hintA11y", { pct: target, price })}
      onPress={onPress}
      style={[typography.caption, { color: colors.textSecondary, minHeight: layout.controlHeight - 12, textAlignVertical: "center" }]}
    >
      {before}
      <Text style={{ textDecorationLine: "underline", color: colors.text }}>{`${target}${sign}`}</Text>
      {after.slice(sign.length)}
    </Text>
  );
}

/** The project's target margin as a whole percent from 1 to 95 (mockup 2f, "65%"). */
export function TargetSheet({ initial, onSave, onClose }: { initial: number; onSave: (value: number) => Promise<boolean>; onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(String(initial));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const value = parseTarget(text);
  const error = submitted && value === null ? t("products.errors.targetInvalid") : null;

  async function save() {
    setSubmitted(true);
    if (value === null || busy) return;
    setBusy(true);
    const ok = await onSave(value).catch(() => false);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <SheetModal title={t("products.targetTitle")} onClose={onClose} action={{ label: t("products.save"), onPress: save }}>
      <TextField
        label={t("products.targetLabel")}
        icon="trending-up-outline"
        keyboardType="number-pad"
        autoFocus
        maxLength={3}
        value={text}
        onChangeText={(v) => setText(v.replace(/\D/g, ""))}
        error={error}
        onSubmitEditing={save}
      />
      <Hint>{t("products.targetHint")}</Hint>
    </SheetModal>
  );
}

/** The selling price of one size with the live profit and margin (mockup 2f). Empty means no price. */
export function PriceSheet({
  sizeLabel,
  currency,
  initial,
  cost,
  target,
  onSave,
  onSaveTarget,
  onClose,
}: {
  sizeLabel: string;
  currency: Currency;
  initial: number | null;
  cost: number;
  target: number;
  onSave: (price: number | null) => Promise<boolean>;
  onSaveTarget: (value: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [text, setText] = useState(initial === null ? "" : currency === "VND" ? formatPriceText(String(initial), currency) : String(initial / 100));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const empty = text.trim() === "";
  const parsed = empty ? null : parsePriceText(text, currency);
  const valid = empty || validMoney(parsed);
  const gain = parsed !== null && validMoney(parsed) ? parsed - cost : null;
  const margin = gain === null ? null : marginPct(gain, parsed);
  const error = submitted && !valid ? t("products.errors.moneyInvalid") : null;

  async function save() {
    setSubmitted(true);
    if (!valid || busy) return;
    setBusy(true);
    const ok = await onSave(empty ? null : parsed).catch(() => false);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <SheetModal title={t("products.priceTitle", { size: sizeLabel })} onClose={onClose} action={{ label: t("products.save"), onPress: save }}>
      <View style={{ gap: spacing[1] }}>
        <TextField
          label={t("products.priceLabel")}
          icon="cash-outline"
          keyboardType={currency === "VND" ? "number-pad" : "decimal-pad"}
          autoFocus
          placeholder={moneyOf(0, currency)}
          value={text}
          onChangeText={(v) => setText(currency === "VND" ? formatPriceText(v, currency) : v.replace(/[^\d.,]/g, ""))}
          error={error}
          onSubmitEditing={save}
        />
        <Hint>{t("products.priceEmptyHint")}</Hint>
        <PriceHint cost={cost} target={target} currency={currency} onPress={() => setTargetOpen(true)} />
      </View>
      <Card flush>
        <View style={{ paddingHorizontal: spacing[2] }} accessibilityLiveRegion="polite">
          <SummaryRow label={t("products.priceCost")} value={moneyOf(cost, currency)} />
          <SummaryRow
            divider
            label={t("products.priceProfit")}
            value={gain === null ? "–" : margin === null ? moneyOf(gain, currency) : t("products.priceProfitValue", { profit: moneyOf(gain, currency), margin })}
            valueColor={gain === null ? undefined : gain >= 0 ? colors.success : colors.text}
          />
        </View>
      </Card>
      {targetOpen ? <TargetSheet initial={target} onSave={onSaveTarget} onClose={() => setTargetOpen(false)} /> : null}
    </SheetModal>
  );
}
