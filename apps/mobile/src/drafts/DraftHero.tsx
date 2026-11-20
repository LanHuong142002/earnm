import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { moneyOf } from "../ingredients/display";
import type { Currency } from "../lib/currency";
import type { SizeName } from "../products/types";
import { useTheme } from "../theme/useTheme";
import type { DraftEstimate } from "./estimate";

/**
 * The orange card of a Done draft (mockup A7): expected profit per cup of the base size with its margin, and the cost
 * twice: the recipe alone and with the default ingredients and extras. Without an expected price it shows the cost.
 * Same look as the product's hero.
 */
export function DraftHero({
  size,
  estimate,
  price,
  currency,
}: {
  size: SizeName;
  estimate: DraftEstimate;
  price: number | null;
  currency: Currency;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing, onFixed } = useTheme();
  const total = estimate.total;
  if (total === null) return null;
  const profitShown = price !== null && estimate.profit !== null;
  const heroText = { color: onFixed };
  const big = profitShown ? (estimate.profit ?? 0) : total;
  const titleKey = profitShown ? "drafts.heroProfit" : "drafts.heroCost";
  const caption = profitShown
    ? estimate.marginPct === null
      ? ""
      : t("drafts.heroMargin", { pct: estimate.marginPct, price: moneyOf(price, currency) })
    : t("drafts.heroNoPrice");
  return (
    <View
      accessible
      accessibilityLabel={`${t(titleKey, { size })}, ${moneyOf(big, currency)}${caption ? `, ${caption}` : ""}`}
      style={{ gap: spacing[0], padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.accentStrong }}
    >
      <Text style={[typography.label, heroText]}>{t(titleKey, { size })}</Text>
      <Text style={[typography.screenTitle, heroText]}>{moneyOf(big, currency)}</Text>
      {caption ? <Text style={[typography.caption, heroText]}>{caption}</Text> : null}
      <View style={{ flexDirection: "row", gap: spacing[2], marginTop: spacing[0], paddingTop: spacing[1], borderTopWidth: 1, borderTopColor: onFixed + "40" }}>
        <View style={{ flex: 1 }}>
          <Text style={[typography.caption, heroText]}>{t("drafts.heroRecipe")}</Text>
          <Text style={[typography.bodyStrong, heroText]}>{moneyOf(estimate.recipeCost, currency)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[typography.caption, heroText]}>{t("drafts.heroTotal")}</Text>
          <Text style={[typography.bodyStrong, heroText]}>{moneyOf(total, currency)}</Text>
        </View>
      </View>
    </View>
  );
}
