import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { baseUnitOf, formatPriceText, formatQuantity, moneyOf } from "../ingredients/display";
import type { Ingredient } from "../ingredients/types";
import type { Currency } from "../lib/currency";
import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { Collapsible } from "../ui/Collapsible";
import { PressableScale } from "../ui/PressableScale";
import { lineCost } from "./cost";
import { DefaultChip, Hint, LinkRow, Tick } from "./ProductBits";
import type { ProductSize } from "./types";
import type { FixedCostState, SizeFigures } from "./view";

/** What the detail screen knows about the fixed costs: how they reach this product, the share and what it is made of. */
export type FixedCostInfo = { state: FixedCostState; share: number | null; total: number; cups: number | null };

/** One line of a recipe or of the extras: optional tick, name, a quiet second line and its cost. Tapping the body opens its sheet. */
function Line({
  name,
  chip,
  detail,
  cost,
  off,
  tick,
  divider,
  onOpen,
}: {
  name: string;
  chip: boolean;
  detail: string | null;
  cost: string;
  off: boolean;
  tick: { on: boolean; label: string; onPress: () => void } | null;
  divider: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, spacing } = useTheme();
  const muted = off ? colors.textSecondary : colors.text;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: layout.controlHeight + spacing[0],
        borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderTopColor: colors.border,
      }}
    >
      {tick ? <Tick on={tick.on} label={tick.label} onPress={tick.onPress} /> : null}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={[name, detail, cost, chip ? t("products.defaultChip") : null].filter(Boolean).join(", ")}
        onPress={onOpen}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing[1], minHeight: layout.controlHeight, paddingVertical: spacing[0] }}
      >
        <View style={{ flex: 1, gap: spacing[0] / 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0], flexWrap: "wrap" }}>
            <Text style={[typography.body, { color: muted }]}>{name}</Text>
            {chip ? <DefaultChip label={t("products.defaultChip")} /> : null}
          </View>
          {detail ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{detail}</Text> : null}
        </View>
        <Text style={[typography.bodyStrong, { color: muted, textDecorationLine: off ? "line-through" : "none" }]}>{cost}</Text>
      </PressableScale>
    </View>
  );
}

/** "Công thức · n" and "Chi phí thêm · n" (mockups 2b and 2c): closed at first with their totals; open, the lines and the size's total cost. */
export function RecipeSections({
  size,
  figures,
  ingredients,
  currency,
  fixed,
  onOpenFixed,
  onToggleLine,
  onOpenLine,
  onAddLine,
  onToggleExtra,
  onOpenExtra,
  onAddExtra,
}: {
  size: ProductSize;
  figures: SizeFigures;
  ingredients: Readonly<Record<string, Ingredient | undefined>>;
  currency: Currency;
  fixed: FixedCostInfo;
  onOpenFixed: () => void;
  onToggleLine: (ingredientId: string) => void;
  onOpenLine: (ingredientId: string) => void;
  onAddLine: () => void;
  onToggleExtra: (extraId: string) => void;
  onOpenExtra: (extraId: string) => void;
  onAddExtra: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, spacing, iconSize } = useTheme();
  const [open, setOpen] = useState({ recipe: false, extras: false });
  const lines = size.lines.filter((l) => ingredients[l.ingredientId]);
  return (
    <View style={{ gap: spacing[1] }}>
      <Card flush>
        <View style={{ paddingHorizontal: spacing[2] }}>
          <Collapsible
            title={t("products.recipeTitle", { count: lines.length })}
            trailing={moneyOf(figures.recipeCost, currency)}
            onToggle={(v) => setOpen((o) => ({ ...o, recipe: v }))}
          >
            <View>
              {lines.map((line, index) => {
                const ingredient = ingredients[line.ingredientId] as Ingredient;
                const unit = t(`ingredients.units.${baseUnitOf(ingredient.purchase.unit)}`);
                return (
                  <Line
                    key={line.ingredientId}
                    divider={index > 0}
                    name={ingredient.name}
                    chip={line.isDefault}
                    detail={line.included ? t("products.amountLine", { amount: formatQuantity(line.amount), unit }) : t("products.notCounted")}
                    cost={moneyOf(lineCost(ingredient, line.amount), currency)}
                    off={!line.included}
                    tick={line.isDefault ? { on: line.included, label: t("products.tickA11y", { name: ingredient.name }), onPress: () => onToggleLine(line.ingredientId) } : null}
                    onOpen={() => onOpenLine(line.ingredientId)}
                  />
                );
              })}
              <LinkRow divider label={t("products.addIngredient")} onPress={onAddLine} />
            </View>
          </Collapsible>
        </View>
      </Card>
      <Card flush>
        <View style={{ paddingHorizontal: spacing[2] }}>
          <Collapsible
            title={t("products.extrasTitle", { count: size.extras.length })}
            trailing={moneyOf(figures.extrasCost, currency)}
            onToggle={(v) => setOpen((o) => ({ ...o, extras: v }))}
          >
            <View>
              {size.extras.map((extra, index) => (
                <Line
                  key={extra.id}
                  divider={index > 0}
                  name={extra.name}
                  chip={extra.isDefault}
                  detail={extra.included ? null : t("products.notCounted")}
                  cost={moneyOf(extra.amount, currency)}
                  off={!extra.included}
                  tick={{ on: extra.included, label: t("products.tickA11y", { name: extra.name }), onPress: () => onToggleExtra(extra.id) }}
                  onOpen={() => onOpenExtra(extra.id)}
                />
              ))}
              <LinkRow divider label={t("products.addExtra")} onPress={onAddExtra} />
            </View>
          </Collapsible>
        </View>
      </Card>
      {fixed.state === "none" ? null : (
        <>
          <Card flush>
            <View style={{ paddingHorizontal: spacing[2] }}>
              <PressableScale
                accessibilityRole="link"
                accessibilityLabel={`${t("products.fixedShareRow")}, ${fixed.share === null ? t("products.fixedShareUnset") : moneyOf(fixed.share, currency)}`}
                onPress={onOpenFixed}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[1], minHeight: layout.controlHeight + spacing[0] }}
              >
                <Text style={[typography.body, { color: colors.text }]}>{t("products.fixedShareRow")}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
                  <Text style={[typography.bodyStrong, { color: fixed.share === null ? colors.accentStrong : colors.text }]}>
                    {fixed.share === null ? t("products.fixedShareUnset") : moneyOf(fixed.share, currency)}
                  </Text>
                  <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} />
                </View>
              </PressableScale>
            </View>
          </Card>
          <Hint>
            {fixed.share !== null && fixed.cups !== null
              ? t("products.fixedShareHint", { total: moneyOf(fixed.total, currency), cups: formatPriceText(String(fixed.cups), "VND") })
              : t("products.fixedUnsetHint", { total: moneyOf(fixed.total, currency) })}
          </Hint>
        </>
      )}
      {open.recipe || open.extras ? (
        <View
          accessible
          accessibilityLabel={`${t("products.totalLine", { size: size.size })}, ${moneyOf(figures.cost, currency)}`}
          style={{ flexDirection: "row", justifyContent: "space-between", minHeight: layout.controlHeight }}
        >
          <Text style={[typography.sectionTitle, { color: colors.text }]}>{t("products.totalLine", { size: size.size })}</Text>
          <Text style={[typography.sectionTitle, { color: colors.text }]}>{moneyOf(figures.cost, currency)}</Text>
        </View>
      ) : null}
    </View>
  );
}
