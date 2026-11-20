import { useHeaderHeight } from "expo-router/react-navigation";
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useDrafts } from "../../../../../../../drafts/DraftsProvider";
import type { DraftLineFieldChanges } from "../../../../../../../drafts/DraftsProvider";
import { MODE_ICON } from "../../../../../../../ingredients/IngredientRow";
import { emptyNewLineForm, defaultUnitOf, lineCostText, parseNewLine, type NewLineForm } from "../../../../../../../drafts/newLine";
import { baseSize } from "../../../../../../../drafts/view";
import { baseUnitOf, displayQuantity, formatPriceText, moneyOf, unitsFor } from "../../../../../../../ingredients/display";
import { useIngredients } from "../../../../../../../ingredients/IngredientsProvider";
import type { Ingredient, IngredientMode } from "../../../../../../../ingredients/types";
import { INGREDIENT_MODES } from "../../../../../../../ingredients/types";
import { formatUnitCost, type Currency } from "../../../../../../../lib/currency";
import { useProjects } from "../../../../../../../projects/ProjectsProvider";
import { useGoToProjectList } from "../../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../../projects/routing";
import { Hint, LinkRow } from "../../../../../../../products/ProductBits";
import { useTheme } from "../../../../../../../theme/useTheme";
import { Button } from "../../../../../../../ui/Button";
import { ErrorText } from "../../../../../../../ui/ErrorText";
import { Screen } from "../../../../../../../ui/Screen";
import { Segmented } from "../../../../../../../ui/Segmented";
import { TextField } from "../../../../../../../ui/TextField";
import type { Draft, DraftLineRow } from "../../../../../../../drafts/types";

const typed = (n: number) => String(n).replace(".", ",");

/** The form's texts for a line that already exists in the draft. */
function formOf(line: DraftLineRow, currency: Currency): NewLineForm {
  const mode: IngredientMode = line.newKind ?? "weight";
  const unit = defaultUnitOf(mode);
  return {
    name: line.newName ?? "",
    mode,
    unit,
    qtyText: line.purchaseQty === null ? "" : typed(displayQuantity(line.purchaseQty, unit)),
    priceText: line.purchasePrice === null ? "" : currency === "VND" ? formatPriceText(String(line.purchasePrice), currency) : typed(line.purchasePrice / 100),
    amountText: typed(line.amount),
  };
}

type LineProject = { id: string; currency: Currency };

/** A new-ingredient line of a draft (mockup A5): add one, or edit or remove one that is there. */
export default function DraftLineScreen() {
  const { t } = useTranslation();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const { colors, typography } = useTheme();
  const { id, draftId, lineId, name: presetName } = useLocalSearchParams<{ id: string; draftId: string; lineId?: string; name?: string }>();
  const { status, projects } = useProjects();
  const { ready, draftsFor } = useDrafts();
  const { ready: ingredientsReady } = useIngredients();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const draft = ready && project ? (draftsFor(project.id).find((d) => d.id === draftId) ?? null) : null;
  const line = draft && lineId ? (draft.lines.find((l) => l.id === lineId && l.kind === "new") ?? null) : null;

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  if (!project) return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;
  const missing = !draft || draft.convertedAt !== null || (lineId !== undefined && !line);
  if (missing || !ingredientsReady) {
    return (
      <Screen edges={[]}>
        {ready && ingredientsReady && missing ? (
          <Text accessibilityRole="alert" style={[typography.body, { color: colors.textSecondary }]}>
            {t(draft && lineId && !line ? "drafts.line.notFound" : "drafts.notFound")}
          </Text>
        ) : null}
      </Screen>
    );
  }
  return <LineForm project={project} draft={draft} line={line} preset={presetName ?? ""} />;
}

function LineForm({ project, draft, line, preset }: { project: LineProject; draft: Draft; line: DraftLineRow | null; preset: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const { colors, typography, spacing, layout, radius } = useTheme();
  const { addLine, editLine, removeLine } = useDrafts();
  const { ingredientsFor } = useIngredients();
  const currency = project.currency;
  const lineId = line?.id;
  const [form, setForm] = useState<NewLineForm>(() => (line ? formOf(line, currency) : { ...emptyNewLineForm(), name: preset }));
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const base = baseSize(draft.sizes) ?? "M";
  const ingredientNames = ingredientsFor(project.id).map((i: Ingredient) => i.name);
  const otherNew = draft.lines.filter((l) => l.kind === "new" && l.id !== lineId).map((l) => l.newName ?? "");
  const taken = [...ingredientNames, ...otherNew];
  const parsed = parseNewLine(form, currency, taken);
  const errors = submitted && !parsed.ok ? parsed.errors : {};
  const result = lineCostText(form, currency);
  const portion = form.mode === "portion";
  const unitLabel = t(`ingredients.units.${baseUnitOf(form.unit)}`);
  const set = (patch: Partial<NewLineForm>) => setForm((f) => ({ ...f, ...patch }));
  const nameMessage = errors.name ? t(errors.name === "nameDuplicate" ? "drafts.errors.nameDuplicate" : errors.name === "nameTooLong" ? "drafts.errors.nameTooLong" : "drafts.errors.nameEmpty") : null;
  const amountMessage = errors.amount ? t(`products.errors.amount${errors.amount[0]!.toUpperCase()}${errors.amount.slice(1)}`) : null;

  async function submit() {
    if (inFlight.current) return;
    setSubmitted(true);
    setFormError(null);
    if (!parsed.ok) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const v = parsed.value;
      let ok: boolean;
      if (line) {
        const fields: DraftLineFieldChanges = {};
        if (v.newName !== line.newName) fields.newName = v.newName;
        if (v.newKind !== line.newKind) fields.newKind = v.newKind;
        if (v.purchaseQty !== line.purchaseQty) fields.purchaseQty = v.purchaseQty;
        if (v.purchasePrice !== line.purchasePrice) fields.purchasePrice = v.purchasePrice;
        if (v.amount !== line.amount) fields.amount = v.amount;
        ok = Object.keys(fields).length === 0 ? true : (await editLine(project.id, draft.id, line.id, fields)).ok;
      } else {
        ok = (await addLine(project.id, draft.id, { kind: "new", ...v })).ok;
      }
      if (ok) router.back();
      else setFormError(t("errors.generic"));
    } catch {
      setFormError(t("errors.generic"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const confirmRemove = () => {
    if (!line) return;
    Alert.alert(t("drafts.removeLineTitle"), line.newName ?? "", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("drafts.removeLineConfirm"),
        style: "destructive",
        onPress: () => {
          void removeLine(project.id, draft.id, line.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <Screen edges={[]} keyboardOffset={headerHeight} footer={<Button label={t("drafts.line.save")} loading={busy} onPress={submit} />}>
      <Stack.Screen options={{ title: t(line ? "drafts.line.editTitle" : "drafts.line.newTitle") }} />
      <View style={{ gap: spacing[2] }}>
        <TextField
          label={t("drafts.line.nameLabel")}
          icon="nutrition-outline"
          placeholder={t("drafts.line.namePlaceholder")}
          autoFocus={!line}
          value={form.name}
          onChangeText={(name) => set({ name })}
          error={nameMessage}
          returnKeyType="next"
          editable={!busy}
        />
        <View style={{ gap: spacing[0] }}>
          <Text style={[typography.label, { color: colors.text }]}>{t("drafts.line.modeLabel")}</Text>
          <Segmented
            accessibilityLabel={t("drafts.line.modeLabel")}
            value={form.mode}
            options={INGREDIENT_MODES.map((mode) => ({ value: mode, label: t(`drafts.mode.${mode}`) }))}
            onChange={(mode) => set({ mode, unit: defaultUnitOf(mode) })}
          />
        </View>
        <View style={{ flexDirection: "row", gap: spacing[1], alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <TextField
              label={t(portion ? "drafts.line.qtyLabelPortion" : "drafts.line.qtyLabel")}
              icon={MODE_ICON[form.mode]}
              error={errors.qty ? t("drafts.errors.qtyInvalid") : null}
              value={form.qtyText}
              onChangeText={(text) => set({ qtyText: text.replace(/[^\d.,]/g, "") })}
              keyboardType="decimal-pad"
              placeholder="0"
              editable={!busy}
            />
          </View>
          {portion ? (
            <View style={{ marginTop: typography.label.lineHeight + spacing[0], minHeight: layout.controlHeight, justifyContent: "center" }}>
              <Text style={[typography.bodyStrong, { color: colors.textSecondary }]}>{t("ingredients.units.portion")}</Text>
            </View>
          ) : (
            <View style={{ marginTop: typography.label.lineHeight + spacing[0] }}>
              <Segmented
                compact
                accessibilityLabel={t("ingredients.quantityUnitA11y")}
                value={form.unit}
                options={unitsFor(form.mode).map((unit) => ({ value: unit, label: t(`ingredients.units.${unit}`) }))}
                onChange={(unit) => set({ unit })}
              />
            </View>
          )}
        </View>
        <TextField
          label={t("drafts.line.priceLabel")}
          icon="cash-outline"
          placeholder={moneyOf(0, currency)}
          error={errors.price ? t("drafts.errors.priceInvalid") : null}
          value={form.priceText}
          onChangeText={(text) => set({ priceText: currency === "VND" ? formatPriceText(text, currency) : text.replace(/[^\d.,]/g, "") })}
          keyboardType={currency === "VND" ? "number-pad" : "decimal-pad"}
          editable={!busy}
        />
        <TextField
          label={t("drafts.line.amountLabel", { size: base })}
          icon="scale-outline"
          placeholder="0"
          error={amountMessage}
          value={form.amountText}
          onChangeText={(text) => set({ amountText: text.replace(/[^\d.,]/g, "") })}
          keyboardType="decimal-pad"
          editable={!busy}
        />
        {result ? (
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={t("drafts.line.resultA11y", { perUnit: `${formatUnitCost(result.perUnit, currency)}/${unitLabel}`, amount: result.amount, unit: unitLabel, cost: moneyOf(result.cost, currency) })}
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
            <Text style={[typography.body, { color: colors.textSecondary, flexShrink: 1 }]}>
              {t("drafts.line.result", { perUnit: `${formatUnitCost(result.perUnit, currency)}/${unitLabel}`, amount: typed(result.amount), unit: unitLabel })}
            </Text>
            <Text style={[typography.sectionTitle, { color: colors.text }]}>{moneyOf(result.cost, currency)}</Text>
          </View>
        ) : null}
        <Hint>{t("drafts.line.hint")}</Hint>
        {formError ? <ErrorText message={formError} /> : null}
        {line ? <LinkRow danger label={t("drafts.line.remove")} onPress={confirmRemove} /> : null}
      </View>
    </Screen>
  );
}
