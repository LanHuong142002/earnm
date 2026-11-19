import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { per1 } from "../ingredients/cost";
import { baseUnitOf, formatPriceText, moneyOf, parsePriceText } from "../ingredients/display";
import type { Ingredient } from "../ingredients/types";
import { formatUnitCost, type Currency } from "../lib/currency";
import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import { TextField } from "../ui/TextField";
import { lineCost } from "./cost";
import { Hint, LinkRow } from "./ProductBits";
import { parseAmount, validMoney, type AmountError } from "./recipeEdit";
import { SheetModal } from "./SheetModal";
import type { ExtraCost } from "./types";
import { matchesQuery } from "./view";

const AMOUNT_ERROR_KEY: Record<AmountError, string> = {
  invalid: "products.errors.amountInvalid",
  zero: "products.errors.amountZero",
  decimals: "products.errors.amountDecimals",
  tooLarge: "products.errors.amountTooLarge",
};

const amountText = (value: number) => (value === 0 ? "" : String(value).replace(".", ","));

/** The amount of one recipe line, with the live cost (mockup 2d). `onRemove` is given only for a line that is not a default. */
export function LineSheet({
  ingredient,
  sizeLabel,
  initial,
  isDefault,
  currency,
  onSave,
  onRemove,
  onClose,
}: {
  ingredient: Ingredient;
  sizeLabel: string;
  initial: number;
  isDefault: boolean;
  currency: Currency;
  onSave: (amount: number) => Promise<boolean>;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const [text, setText] = useState(amountText(initial));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const unit = t(`ingredients.units.${baseUnitOf(ingredient.purchase.unit)}`);
  // A default line may stay at 0 until it is filled in; any other line needs more than 0.
  const parsed = parseAmount(text.trim() === "" && isDefault ? "0" : text, { allowZero: isDefault });
  const cost = parsed.ok ? lineCost(ingredient, parsed.value) : 0;
  const one = per1(ingredient.purchase.price, ingredient.purchase.quantity);
  const perUnit = one === null ? "" : `${formatUnitCost(one, currency)}/${unit}`;
  const error = submitted && !parsed.ok ? t(AMOUNT_ERROR_KEY[parsed.error]) : null;

  async function save() {
    setSubmitted(true);
    if (!parsed.ok || busy) return;
    setBusy(true);
    const ok = await onSave(parsed.value).catch(() => false);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <SheetModal title={t("products.lineTitle", { name: ingredient.name, size: sizeLabel })} onClose={onClose} action={{ label: t("products.save"), onPress: save }}>
      <TextField
        label={t("products.lineAmountLabel", { unit })}
        icon="scale-outline"
        keyboardType="decimal-pad"
        autoFocus
        placeholder="0"
        value={text}
        onChangeText={(v) => setText(v.replace(/[^\d.,]/g, ""))}
        error={error}
        onSubmitEditing={save}
      />
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${t("products.lineCalc", { perUnit, amount: parsed.ok ? parsed.value : 0, unit })}, ${moneyOf(cost, currency)}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[1],
          padding: spacing[2],
          borderRadius: radius.tile,
          borderWidth: 1,
          borderColor: colors.tileBorder,
          backgroundColor: colors.tile,
        }}
      >
        <Text style={[typography.label, { color: colors.textSecondary, flexShrink: 1 }]}>
          {t("products.lineCalc", { perUnit, amount: parsed.ok ? parsed.value : 0, unit })}
        </Text>
        <Text style={[typography.sectionTitle, { color: colors.text }]}>{moneyOf(cost, currency)}</Text>
      </View>
      {onRemove ? <LinkRow danger center label={t("products.removeLine")} onPress={onRemove} /> : null}
    </SheetModal>
  );
}

/** One row of a picker: a title, a second line and a value, dimmed and not tappable when `disabled`. */
function PickRow({
  title,
  sub,
  value,
  disabled = false,
  divider,
  onPress,
}: {
  title: string;
  sub: string;
  value?: string;
  disabled?: boolean;
  divider: boolean;
  onPress: () => void;
}) {
  const { colors, typography, layout, spacing, disabled: disabledStyle } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${sub}${value ? `, ${value}` : ""}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing[1],
        minHeight: layout.controlHeight + spacing[2],
        paddingVertical: spacing[1],
        opacity: disabled ? disabledStyle.opacity : 1,
        borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderTopColor: colors.border,
      }}
    >
      <View style={{ flex: 1, gap: spacing[0] / 2 }}>
        <Text style={[typography.bodyStrong, { color: colors.text }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{sub}</Text>
      </View>
      {value ? <Text style={[typography.bodyStrong, { color: colors.text }]}>{value}</Text> : null}
    </PressableScale>
  );
}

/** The ingredient picker (mockup 2e): a search box, "Đã có" greyed for the ones the size has, and a link to a new ingredient. */
export function IngredientPickerSheet({
  ingredients,
  taken,
  sizeLabel,
  currency,
  onPick,
  onNew,
  onClose,
}: {
  ingredients: readonly Ingredient[];
  taken: ReadonlySet<string>;
  sizeLabel: string;
  currency: Currency;
  onPick: (ingredient: Ingredient) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const shown = ingredients.filter((i) => matchesQuery(i.name, query));
  return (
    <SheetModal title={t("products.pickerTitle", { size: sizeLabel })} onClose={onClose}>
      <TextField
        label={t("products.searchLabel")}
        icon="search-outline"
        placeholder={t("products.searchPlaceholder")}
        autoCorrect={false}
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
      />
      <View>
        {shown.map((item, index) => {
          const one = per1(item.purchase.price, item.purchase.quantity);
          const unit = t(`ingredients.units.${baseUnitOf(item.purchase.unit)}`);
          const already = taken.has(item.id);
          return (
            <PickRow
              key={item.id}
              divider={index > 0}
              title={item.name}
              sub={already ? t("products.alreadyIn") : t(`ingredients.mode.${item.mode}`)}
              value={one === null ? undefined : t("products.pickerPerUnit", { cost: formatUnitCost(one, currency), unit })}
              disabled={already}
              onPress={() => onPick(item)}
            />
          );
        })}
        {shown.length === 0 ? <Hint>{t(ingredients.length === 0 ? "products.pickerNone" : "products.pickerNoMatch")}</Hint> : null}
        <LinkRow divider label={t("products.pickerNewIngredient")} onPress={onNew} />
      </View>
    </SheetModal>
  );
}

/** The amount of one extra cost of a size. `onRemove` is given only for one that is not a default. */
export function ExtraAmountSheet({
  name,
  sizeLabel,
  initial,
  currency,
  onSave,
  onRemove,
  onClose,
}: {
  name: string;
  sizeLabel: string;
  initial: number;
  currency: Currency;
  onSave: (amount: number) => Promise<boolean>;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(initial === 0 ? "" : currency === "VND" ? formatPriceText(String(initial), currency) : String(initial / 100));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const parsed = text.trim() === "" ? 0 : parsePriceText(text, currency);
  const valid = validMoney(parsed);
  const error = submitted && !valid ? t("products.errors.moneyInvalid") : null;

  async function save() {
    setSubmitted(true);
    if (!validMoney(parsed) || busy) return;
    setBusy(true);
    const ok = await onSave(parsed).catch(() => false);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <SheetModal title={t("products.extraSheetTitle", { name, size: sizeLabel })} onClose={onClose} action={{ label: t("products.save"), onPress: save }}>
      <TextField
        label={t("products.extraAmountLabel")}
        icon="cash-outline"
        keyboardType={currency === "VND" ? "number-pad" : "decimal-pad"}
        autoFocus
        placeholder={moneyOf(0, currency)}
        value={text}
        onChangeText={(v) => setText(currency === "VND" ? formatPriceText(v, currency) : v.replace(/[^\d.,]/g, ""))}
        error={error}
        onSubmitEditing={save}
      />
      {onRemove ? <LinkRow danger center label={t("products.removeExtra")} onPress={onRemove} /> : null}
    </SheetModal>
  );
}

/** The project's extra costs the size does not have yet; a tap copies one into the size. */
export function ExtraPickerSheet({
  extraCosts,
  sizeLabel,
  currency,
  onPick,
  onManage,
  onClose,
}: {
  extraCosts: readonly ExtraCost[];
  sizeLabel: string;
  currency: Currency;
  onPick: (extra: ExtraCost) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <SheetModal title={t("products.pickExtraTitle", { size: sizeLabel })} onClose={onClose}>
      <View>
        {extraCosts.map((item, index) => (
          <PickRow
            key={item.id}
            divider={index > 0}
            title={item.name}
            sub={item.isDefault ? t("products.defaultChip") : ""}
            value={moneyOf(item.amount, currency)}
            onPress={() => onPick(item)}
          />
        ))}
        {extraCosts.length === 0 ? <Hint>{t("products.pickExtraNone")}</Hint> : null}
        <LinkRow divider label={t("products.manageExtras")} onPress={onManage} />
      </View>
    </SheetModal>
  );
}
