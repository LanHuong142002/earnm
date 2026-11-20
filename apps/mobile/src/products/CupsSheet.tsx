import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { formatPriceText, moneyOf } from "../ingredients/display";
import type { Currency } from "../lib/currency";
import { useTheme } from "../theme/useTheme";
import { TextField } from "../ui/TextField";
import { perCupShare } from "./fixedCost";
import { cupsPerDay, EXPECTED_CUPS_MAX, parseCupsText } from "./fixedCostForm";
import { ResultBox } from "./FixedCostScreenForm";
import { Hint } from "./ProductBits";
import { SheetModal } from "./SheetModal";

/** Mockup 1e: the project's one "cups per month" number. An empty field clears it. */
export function CupsSheet({
  initial,
  total,
  currency,
  productCount,
  onSave,
  onClose,
}: {
  initial: number | null;
  total: number;
  currency: Currency;
  productCount: number;
  onSave: (value: number | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const [text, setText] = useState(initial === null ? "" : formatPriceText(String(initial), "VND"));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const value = parseCupsText(text);
  const valid = value === null || (value >= 1 && value <= EXPECTED_CUPS_MAX);
  const share = value !== null && valid ? perCupShare(total, value) : null;

  async function save() {
    setSubmitted(true);
    setFailed(false);
    if (!valid || busy) return;
    setBusy(true);
    const ok = await onSave(value).catch(() => false);
    setBusy(false);
    if (ok) onClose();
    else setFailed(true);
  }

  return (
    <SheetModal title={t("fixedCosts.cupsTitle")} onClose={onClose} action={{ label: t("fixedCosts.save"), onPress: save }}>
      <View style={{ gap: spacing[1] }}>
        <TextField
          label={t("fixedCosts.cupsLabel")}
          icon="cafe-outline"
          keyboardType="number-pad"
          placeholder={t("fixedCosts.cupsPlaceholder")}
          autoFocus
          value={text}
          onChangeText={(v) => setText(formatPriceText(v, "VND"))}
          onSubmitEditing={save}
          error={submitted && !valid ? t("fixedCosts.errors.cupsRange") : failed ? t("fixedCosts.errors.saveFailed") : null}
        />
        {value !== null && valid ? <Hint>{t("fixedCosts.cupsPerDay", { count: cupsPerDay(value) })}</Hint> : null}
        {share !== null ? <ResultBox label={t("fixedCosts.cupsShare")} value={moneyOf(share, currency)} /> : null}
        {productCount > 0 ? <Hint>{t("fixedCosts.cupsProducts", { count: productCount })}</Hint> : null}
      </View>
    </SheetModal>
  );
}
