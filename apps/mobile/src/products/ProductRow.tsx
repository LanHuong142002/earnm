import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { moneyOf } from "../ingredients/display";
import type { Currency } from "../lib/currency";
import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import type { ProductRow as Row } from "./view";

/** One product of the list (mockup 2a): sizes and the price of the summarised size, then its profit; a margin under the target is only noted. */
export function ProductRowView({
  row,
  currency,
  target,
  pending,
  divider,
  onOpen,
}: {
  row: Row;
  currency: Currency;
  target: number;
  pending: boolean;
  divider: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, spacing, iconSize } = useTheme();
  const sum = row.summary;
  const sizes = row.sizes.join(", ");
  const second = sum
    ? sum.figures.price === null
      ? t("products.rowSizesNoPrice", { sizes, size: sum.size })
      : t("products.rowSizes", { sizes, size: sum.size, price: moneyOf(sum.figures.price, currency) })
    : sizes;
  const third = sum
    ? sum.figures.profit === null || sum.figures.price === null
      ? t("products.rowCost", { cost: moneyOf(sum.figures.fullCost, currency) })
      : sum.figures.margin === null
        ? moneyOf(sum.figures.profit, currency)
        : t("products.rowProfit", { profit: moneyOf(sum.figures.profit, currency), margin: sum.figures.margin })
    : "";
  const below = sum?.figures.belowTarget ? t("products.belowTarget", { pct: target }) : "";
  const label = [t("products.rowA11y", { name: row.name, summary: [second, third, below].filter(Boolean).join(", ") }), pending ? t("products.pending") : null]
    .filter(Boolean)
    .join(", ");
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onOpen}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing[1],
        minHeight: layout.controlHeight + spacing[3],
        paddingVertical: spacing[1],
        borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderTopColor: colors.border,
      }}
    >
      <View style={{ flex: 1, gap: spacing[0] / 2 }}>
        <Text style={[typography.bodyStrong, { color: colors.text }]} numberOfLines={2}>
          {row.name}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {second}
          {pending ? ` · ${t("products.pending")}` : ""}
        </Text>
        {third ? (
          <Text style={[typography.label, { color: colors.text }]}>
            {third}
            {below ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{` ${below}`}</Text> : null}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} />
    </PressableScale>
  );
}
