import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { baseUnitOf, formatQuantity, moneyOf } from "../ingredients/display";
import type { Ingredient, IngredientMode } from "../ingredients/types";
import type { Currency } from "../lib/currency";
import { DefaultChip, LinkRow } from "../products/ProductBits";
import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { Collapsible } from "../ui/Collapsible";
import { PressableScale } from "../ui/PressableScale";
import { lineEstimate } from "./estimate";
import type { DraftLineRow } from "./types";
import { estimateLines } from "./view";

const MODE_UNIT: Record<IngredientMode, "g" | "ml" | "portion"> = { weight: "g", volume: "ml", portion: "portion" };

/**
 * "Công thức 1 ly size M · n" (mockups A3, A7, A9): the base recipe's lines. A new ingredient has the "Mới" tag and,
 * without a purchase price, "Thiếu giá" in the danger colour. `onOpenLine` and `onAdd` are left out when read-only.
 */
export function DraftRecipe({
  title,
  lines,
  ingredients,
  currency,
  recipeCost,
  defaultOpen,
  onOpenLine,
  onAdd,
}: {
  title: string;
  lines: readonly DraftLineRow[];
  ingredients: readonly Ingredient[];
  currency: Currency;
  /** Shown next to the title while it is closed or open: the cost of the recipe alone, when every price is known. */
  recipeCost: number | null;
  defaultOpen: boolean;
  onOpenLine?: (line: DraftLineRow) => void;
  onAdd?: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, spacing } = useTheme();
  return (
    <Card flush>
      <View style={{ paddingHorizontal: spacing[2] }}>
        <Collapsible title={title} trailing={recipeCost === null ? undefined : moneyOf(recipeCost, currency)} defaultOpen={defaultOpen}>
          <View>
            {lines.map((row, index) => {
              const found = row.kind === "existing" ? ingredients.find((i) => i.id === row.ingredientId) : undefined;
              const name = row.kind === "new" ? (row.newName ?? "") : (found?.name ?? t("drafts.ingredientGone"));
              const unit = t(`ingredients.units.${row.kind === "new" ? MODE_UNIT[row.newKind ?? "weight"] : found ? baseUnitOf(found.purchase.unit) : "g"}`);
              const estimateLine = estimateLines([row])[0];
              const cost = estimateLine ? lineEstimate(estimateLine, ingredients) : 0;
              const amount = `${formatQuantity(row.amount)} ${unit}`;
              const costText = cost === null ? t("drafts.noPrice") : moneyOf(cost, currency);
              const body = (
                <>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing[0] }}>
                    <Text style={[typography.body, { color: colors.text }]}>{name}</Text>
                    {row.kind === "new" ? <DefaultChip label={t("drafts.newTag")} /> : null}
                    <Text style={[typography.caption, { color: colors.textSecondary }]}>{amount}</Text>
                  </View>
                  <Text style={[typography.bodyStrong, { color: cost === null ? colors.danger : colors.text }]}>{costText}</Text>
                </>
              );
              const rowStyle = {
                flexDirection: "row" as const,
                alignItems: "center" as const,
                gap: spacing[1],
                minHeight: layout.controlHeight + spacing[0],
                paddingVertical: spacing[0],
                borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                borderTopColor: colors.border,
              };
              return onOpenLine ? (
                <PressableScale
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={t("drafts.lineA11y", { name, amount, cost: costText })}
                  onPress={() => onOpenLine(row)}
                  style={rowStyle}
                >
                  {body}
                </PressableScale>
              ) : (
                <View key={row.id} accessible accessibilityLabel={t("drafts.lineA11y", { name, amount, cost: costText })} style={rowStyle}>
                  {body}
                </View>
              );
            })}
            {onAdd ? <LinkRow divider={lines.length > 0} label={t("drafts.addLine")} onPress={onAdd} /> : null}
          </View>
        </Collapsible>
      </View>
    </Card>
  );
}
