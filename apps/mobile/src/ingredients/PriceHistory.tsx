import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatUnitCost, type Currency } from "../lib/currency";
import { useTheme } from "../theme/useTheme";
import { Collapsible } from "../ui/Collapsible";
import { per1 } from "./cost";
import { baseUnitOf, displayQuantity, formatQuantity, moneyOf } from "./display";
import type { PriceEntry } from "./types";

/** "Lịch sử giá (n)" of the edit screen (mockup 1f): closed at first; newest first, the first one marked "đang dùng". */
export function PriceHistory({ entries, currency }: { entries: readonly PriceEntry[]; currency: Currency }) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius, layout } = useTheme();
  if (entries.length === 0) return null;
  return (
    <Collapsible title={t("ingredients.history.title", { count: entries.length })}>
      <View
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.card,
          paddingHorizontal: spacing[2],
        }}
      >
        {entries.map((entry, index) => {
          const when = new Date(entry.recordedAt);
          const date = t("ingredients.history.date", { day: when.getDate(), month: when.getMonth() + 1 });
          const author = entry.author?.displayName ?? t("ingredients.formerMember");
          const unit = t(`ingredients.units.${entry.unit}`);
          const baseUnit = t(`ingredients.units.${baseUnitOf(entry.unit)}`);
          const one = per1(entry.price, entry.quantity);
          const cost = one === null ? "" : t("ingredients.rowPerOne", { cost: formatUnitCost(one, currency), unit: baseUnit });
          const line = t("ingredients.history.entry", {
            price: moneyOf(entry.price, currency),
            quantity: formatQuantity(displayQuantity(entry.quantity, entry.unit)),
            unit,
          });
          const current = index === 0;
          const meta = t("ingredients.history.meta", { date, author });
          const a11y = [t("ingredients.history.entryA11y", { entry: line, meta, perOne: cost, unit: baseUnit }), current ? t("ingredients.history.current") : null]
            .filter(Boolean)
            .join(", ");
          return (
            <View
              key={entry.id}
              accessible
              accessibilityLabel={a11y}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing[1],
                minHeight: layout.controlHeight,
                paddingVertical: spacing[1],
                borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                borderTopColor: colors.border,
              }}
            >
              <View style={{ flex: 1, gap: spacing[0] / 2 }}>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>{line}</Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  {meta}
                  {current ? " · " : ""}
                  {current ? <Text style={[typography.caption, { color: colors.accentStrong }]}>{t("ingredients.history.current")}</Text> : null}
                </Text>
              </View>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>{cost}</Text>
            </View>
          );
        })}
      </View>
    </Collapsible>
  );
}
