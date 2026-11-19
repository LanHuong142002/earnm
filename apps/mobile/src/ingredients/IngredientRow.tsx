import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatUnitCost, type Currency } from "../lib/currency";
import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import { per1, per10 } from "./cost";
import { baseUnitOf, displayQuantity, formatQuantity, moneyOf } from "./display";
import type { Ingredient, IngredientMode } from "./types";

type IconName = ComponentProps<typeof Ionicons>["name"];

export const MODE_ICON: Record<IngredientMode, IconName> = {
  weight: "scale-outline",
  volume: "water-outline",
  portion: "cube-outline",
};

/** One ingredient of the list (mockup 1b): mode icon, name, "Mặc định" chip, last purchase, and its cost per 1 and per 10 units. */
export function IngredientRow({
  item,
  currency,
  pending,
  divider,
  onOpen,
}: {
  item: Ingredient;
  currency: Currency;
  /** A change of this ingredient waits to be saved ("Chờ lưu"). */
  pending: boolean;
  /** Hairline above the row; set it on every row but the first. */
  divider: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing, layout, iconSize } = useTheme();
  const { quantity, unit, price } = item.purchase;
  const baseUnit = t(`ingredients.units.${baseUnitOf(unit)}`);
  const one = per1(price, quantity);
  const ten = per10(price, quantity);
  const perOne = one === null ? null : t("ingredients.rowPerOne", { cost: formatUnitCost(one, currency), unit: baseUnit });
  const perTen = ten === null ? null : t("ingredients.rowPerTen", { cost: moneyOf(ten, currency), unit: baseUnit });
  const purchase = t("ingredients.purchaseLine", {
    quantity: formatQuantity(displayQuantity(quantity, unit)),
    unit: t(`ingredients.units.${unit}`),
    price: moneyOf(price, currency),
  });
  const label = [
    t("ingredients.rowA11y", { name: item.name, purchase, perOne: perOne ?? "", unit: baseUnit }),
    pending ? t("ingredients.pending") : null,
  ]
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
        gap: spacing[1] + spacing[0],
        minHeight: layout.controlHeight + spacing[2],
        paddingVertical: spacing[1],
        borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderTopColor: colors.border,
      }}
    >
      <View
        style={{
          width: iconSize.xl + spacing[0],
          height: iconSize.xl + spacing[0],
          borderRadius: radius.field,
          borderWidth: 1,
          borderColor: colors.tileBorder,
          backgroundColor: colors.tile,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={MODE_ICON[item.mode]} size={iconSize.sm} color={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: spacing[0] / 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
          <Text style={[typography.bodyStrong, { color: colors.text, flexShrink: 1 }]} numberOfLines={2}>
            {item.name}
          </Text>
          {item.isDefault ? (
            <View
              style={{
                paddingVertical: spacing[0] / 2,
                paddingHorizontal: spacing[0] + 2,
                borderRadius: radius.pill,
                backgroundColor: colors.tile,
              }}
            >
              <Text style={[typography.caption, { color: colors.accentStrong }]}>{t("ingredients.defaultChip")}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
          {purchase}
          {pending ? ` · ${t("ingredients.pending")}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: spacing[0] / 2 }}>
        {perOne ? <Text style={[typography.bodyStrong, { color: colors.text }]}>{perOne}</Text> : null}
        {perTen ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{perTen}</Text> : null}
      </View>
    </PressableScale>
  );
}
