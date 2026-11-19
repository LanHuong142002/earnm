import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, useState, type ReactNode } from "react";
import { Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatUnitCost, type Currency } from "../lib/currency";
import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Enter } from "../ui/Enter";
import { ErrorText } from "../ui/ErrorText";
import { Screen } from "../ui/Screen";
import { Segmented } from "../ui/Segmented";
import { TextField } from "../ui/TextField";
import {
  baseUnitOf,
  changeMode,
  formatPriceText,
  liveResult,
  moneyOf,
  purchaseFromForm,
  unitsFor,
  validationInput,
  type IngredientFormValues,
} from "./display";
import { MODE_ICON } from "./IngredientRow";
import { INGREDIENT_MODES, type Purchase } from "./types";
import { validateIngredient } from "./validate";

/**
 * Shared by "Nguyên liệu mới" and the edit screen (mockups 1c to 1f). Errors only show after Lưu is tapped, then follow
 * the fields. `onSubmit` gets the valid form and its purchase in base units and answers whether it was saved.
 */
export function IngredientForm({
  initial,
  currency,
  existingNames,
  onSubmit,
  extra,
}: {
  initial: IngredientFormValues;
  currency: Currency;
  /** The other ingredients' names, for the duplicate check (the one being edited is left out). */
  existingNames: readonly string[];
  onSubmit: (form: IngredientFormValues, purchase: Purchase) => Promise<boolean>;
  /** Sections under the form, e.g. the price history and the delete button of the edit screen. */
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius, layout } = useTheme();
  // The Home stack header sits above this screen; the keyboard overlap must account for it.
  const headerHeight = useHeaderHeight();
  const [form, setForm] = useState<IngredientFormValues>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const errors = submitted ? validateIngredient(validationInput(form, currency), existingNames, currency) : {};
  const result = liveResult(form, currency);
  const portion = form.mode === "portion";
  const baseUnit = t(`ingredients.units.${baseUnitOf(form.unit)}`);
  const message = (key?: string) => (key ? t(key) : null);
  const units = unitsFor(form.mode);

  async function submit() {
    if (inFlight.current) return;
    setSubmitted(true);
    setFormError(null);
    const found = validateIngredient(validationInput(form, currency), existingNames, currency);
    const purchase = purchaseFromForm(form, currency);
    if (Object.keys(found).length > 0 || purchase === null) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const saved = await onSubmit(form, purchase);
      if (!saved) setFormError(t("errors.generic"));
    } catch {
      setFormError(t("errors.generic"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen edges={[]} keyboardOffset={headerHeight} footer={<Button label={t("ingredients.save")} loading={busy} onPress={submit} />}>
      <Enter index={0}>
        <View style={{ gap: spacing[2] }}>
          <TextField
            label={t("ingredients.nameLabel")}
            icon="nutrition-outline"
            placeholder={t("ingredients.namePlaceholder")}
            error={message(errors.name)}
            value={form.name}
            onChangeText={(name) => setForm((f) => ({ ...f, name }))}
            autoCapitalize="sentences"
            returnKeyType="next"
            editable={!busy}
          />
          <View style={{ gap: spacing[0] }}>
            <Text style={[typography.label, { color: colors.text }]}>{t("ingredients.modeLabel")}</Text>
            <Segmented
              accessibilityLabel={t("ingredients.modeLabel")}
              value={form.mode}
              options={INGREDIENT_MODES.map((mode) => ({ value: mode, label: t(`ingredients.mode.${mode}`) }))}
              onChange={(mode) => setForm((f) => changeMode(f, mode))}
            />
          </View>
          <View style={{ flexDirection: "row", gap: spacing[1], alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <TextField
                label={t(portion ? "ingredients.quantityLabelPortion" : "ingredients.quantityLabel")}
                icon={MODE_ICON[form.mode]}
                error={message(errors.quantity)}
                value={form.quantityText}
                onChangeText={(text) => setForm((f) => ({ ...f, quantityText: text.replace(/[^\d.,]/g, "") }))}
                keyboardType="decimal-pad"
                placeholder="0"
                editable={!busy}
              />
            </View>
            {portion ? (
              // The unit is fixed in portion mode; it is shown next to the field instead of as a switch.
              <View
                style={{
                  // Lines up with the field, below its label.
                  marginTop: typography.label.lineHeight + spacing[0],
                  minHeight: layout.controlHeight,
                  justifyContent: "center",
                }}
              >
                <Text style={[typography.bodyStrong, { color: colors.textSecondary }]}>{t("ingredients.units.portion")}</Text>
              </View>
            ) : (
              <View style={{ marginTop: typography.label.lineHeight + spacing[0] }}>
                <Segmented
                  compact
                  accessibilityLabel={t("ingredients.quantityUnitA11y")}
                  value={form.unit}
                  options={units.map((unit) => ({ value: unit, label: t(`ingredients.units.${unit}`) }))}
                  onChange={(unit) => setForm((f) => ({ ...f, unit }))}
                />
              </View>
            )}
          </View>
          <TextField
            label={t("ingredients.priceLabel")}
            icon="cash-outline"
            placeholder={moneyOf(0, currency)}
            error={message(errors.price)}
            value={form.priceText}
            onChangeText={(text) =>
              setForm((f) => ({ ...f, priceText: currency === "VND" ? formatPriceText(text, currency) : text.replace(/[^\d.,]/g, "") }))
            }
            keyboardType={currency === "VND" ? "number-pad" : "decimal-pad"}
            editable={!busy}
          />
          {result ? (
            <Card>
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={[
                  t("ingredients.resultTitle"),
                  t("ingredients.resultPerOne", { cost: formatUnitCost(result.per1, currency), unit: baseUnit }),
                  t("ingredients.resultPerTen", { cost: moneyOf(result.per10, currency), unit: baseUnit }),
                ].join(", ")}
                style={{ gap: spacing[0] / 2 }}
              >
                <Text style={[typography.label, { color: colors.textSecondary }]}>{t("ingredients.resultTitle")}</Text>
                <Text style={[typography.sectionTitle, { color: colors.text }]}>
                  {t("ingredients.resultPerOne", { cost: formatUnitCost(result.per1, currency), unit: baseUnit })}
                </Text>
                <Text style={[typography.body, { color: colors.textSecondary }]}>
                  {t("ingredients.resultPerTen", { cost: moneyOf(result.per10, currency), unit: baseUnit })}
                </Text>
              </View>
            </Card>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing[2],
              minHeight: layout.controlHeight,
              padding: spacing[1] + spacing[0],
              borderRadius: radius.field,
              backgroundColor: colors.field,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>{t("ingredients.defaultLabel")}</Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("ingredients.defaultHint")}</Text>
            </View>
            <Switch
              accessibilityLabel={t("ingredients.defaultLabel")}
              accessibilityHint={t("ingredients.defaultHint")}
              value={form.isDefault}
              onValueChange={(isDefault) => setForm((f) => ({ ...f, isDefault }))}
              trackColor={{ false: colors.border, true: colors.accentStrong }}
              thumbColor={colors.surface}
              ios_backgroundColor={colors.border}
              disabled={busy}
            />
          </View>
          {formError ? <ErrorText message={formError} /> : null}
        </View>
      </Enter>
      {extra ? <Enter index={1}>{extra}</Enter> : null}
    </Screen>
  );
}
