import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DraftHero } from "../../../../../../drafts/DraftHero";
import { DraftRecipe } from "../../../../../../drafts/DraftRecipe";
import { DraftRejectedNoticeView } from "../../../../../../drafts/DraftRejectedNotice";
import { AddLineSheet, DraftMenuSheet, SizesPriceSheet, StatusSheet, TextSheet } from "../../../../../../drafts/DraftSheets";
import { useDrafts } from "../../../../../../drafts/DraftsProvider";
import { draftEstimate, missingForDone } from "../../../../../../drafts/estimate";
import { LinkCard } from "../../../../../../drafts/LinkCard";
import type { DraftLineRow } from "../../../../../../drafts/types";
import { baseSize, convertErrorKey, convertSplit, estimateLines, missingItems, reuseTexts, type MissingItem } from "../../../../../../drafts/view";
import { baseUnitOf, moneyOf } from "../../../../../../ingredients/display";
import { useIngredients } from "../../../../../../ingredients/IngredientsProvider";
import type { Ingredient } from "../../../../../../ingredients/types";
import { OfflineNote } from "../../../../../../projects/OfflineNote";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useGoToProjectList, useTapOnce } from "../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../projects/routing";
import { Hint } from "../../../../../../products/ProductBits";
import { useProducts } from "../../../../../../products/ProductsProvider";
import { LineSheet } from "../../../../../../products/RecipeSheets";
import { joinNames } from "../../../../../../products/view";
import { useTheme } from "../../../../../../theme/useTheme";
import { Button } from "../../../../../../ui/Button";
import { Card } from "../../../../../../ui/Card";
import { Enter } from "../../../../../../ui/Enter";
import { PressableScale } from "../../../../../../ui/PressableScale";
import { Screen } from "../../../../../../ui/Screen";

type Sheet =
  | { kind: "menu" }
  | { kind: "rename" }
  | { kind: "note" }
  | { kind: "sizes" }
  | { kind: "status" }
  | { kind: "add" }
  | { kind: "amount"; ingredientId: string; lineId: string | null };

export default function DraftScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const once = useTapOnce();
  const focused = useIsFocused();
  const { colors, typography, radius, spacing, layout, iconSize } = useTheme();
  const { id, draftId } = useLocalSearchParams<{ id: string; draftId: string }>();
  const { status, projects } = useProjects();
  const drafts = useDrafts();
  const products = useProducts();
  const ingredients = useIngredients();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const { ready, refresh, draftsFor, draftPendingFor, loadedFor } = drafts;
  const { ready: ingredientsReady, refresh: refreshIngredients } = ingredients;
  const { ready: productsReady, refresh: refreshProducts } = products;

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  // The estimate follows the ingredients' prices and the default extra costs, so they are fetched when the screen comes back.
  useFocusEffect(
    useCallback(() => {
      if (!ready || !id) return;
      void refresh(id).catch(() => undefined);
      if (ingredientsReady) void refreshIngredients(id).catch(() => undefined);
      if (productsReady) void refreshProducts(id).catch(() => undefined);
    }, [ready, refresh, id, ingredientsReady, refreshIngredients, productsReady, refreshProducts]),
  );

  const projectId = project?.id ?? "";
  const currency = project?.currency ?? "VND";
  const draft = ready && project ? (draftsFor(projectId).find((d) => d.id === draftId) ?? null) : null;
  const ingredientList: Ingredient[] = ingredientsReady && project ? ingredients.ingredientsFor(projectId) : [];
  const extras = productsReady && project ? products.extraCostsFor(projectId) : [];
  const target = productsReady && project ? products.targetMarginFor(projectId) : 65;

  if (!project) return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;
  if (!draft) {
    return (
      <Screen edges={[]}>
        <OfflineNote />
        <DraftRejectedNoticeView />
        {ready && loadedFor(project.id) && !leaving ? (
          <Text accessibilityRole="alert" style={[typography.body, { color: colors.textSecondary }]}>
            {t("drafts.notFound")}
          </Text>
        ) : null}
      </Screen>
    );
  }

  const converted = draft.convertedAt !== null;
  const done = draft.status === "done";
  const base = baseSize(draft.sizes);
  const close = () => setSheet(null);
  const pending = draftPendingFor(project.id).has(draft.id);
  const lines = estimateLines(draft.lines);
  const estimate = draftEstimate({ lines, ingredients: ingredientList, extraCosts: extras, expectedPrice: draft.expectedPrice, targetMargin: target });
  const missing = missingItems(missingForDone({ name: draft.name, sizes: draft.sizes, lines }));
  const missingHint =
    estimate.total !== null
      ? null
      : estimate.missingPrices.length > 0
        ? t("drafts.hintMissing", { names: estimate.missingPrices.join(", ") })
        : t("drafts.hintMissingIngredient", { count: estimate.missingIngredients });
  const split = convertSplit(draft.lines, ingredientList);
  const product = draft.productId ? (products.productsFor(project.id).find((p) => p.id === draft.productId) ?? null) : null;
  const when = draft.convertedAt ? new Date(draft.convertedAt) : null;
  const sizesText = draft.sizes.map((s) => (s === base ? t("drafts.sizeBase", { size: s }) : s)).join(", ");
  const sizeLine = draft.expectedPrice === null ? t("drafts.sizeNoExpected", { sizes: sizesText }) : t("drafts.sizeExpected", { sizes: sizesText, size: base ?? "", price: moneyOf(draft.expectedPrice, currency) });
  const usedIds = new Set(draft.lines.flatMap((l) => (l.kind === "existing" && l.ingredientId ? [l.ingredientId] : [])));
  const usedNames = draft.lines.flatMap((l) => (l.kind === "new" && l.newName ? [l.newName] : []));
  const lookup = new Map(ingredientList.map((i) => [i.id, i]));

  const openLineScreen = (lineId?: string, name?: string) =>
    once(() => router.push({ pathname: "/projects/[id]/drafts/[draftId]/line", params: { id: project.id, draftId: draft.id, ...(lineId ? { lineId } : {}), ...(name ? { name } : {}) } }));

  const openLine = (row: DraftLineRow) => {
    if (row.kind === "new") return openLineScreen(row.id);
    if (row.ingredientId) setSheet({ kind: "amount", ingredientId: row.ingredientId, lineId: row.id });
  };

  const openMissing = (item: MissingItem) => {
    if (item.kind === "name") return setSheet({ kind: "rename" });
    if (item.kind === "sizes") return setSheet({ kind: "sizes" });
    if (item.kind === "lines") return setSheet({ kind: "add" });
    const row = draft.lines.find((l) => l.kind === "new" && l.newName === item.name);
    close();
    if (row) openLineScreen(row.id);
  };

  const confirmDelete = () => {
    close();
    Alert.alert(t("drafts.deleteTitle", { name: draft.name }), t(converted ? "drafts.deleteConvertedMessage" : "drafts.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("drafts.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          setLeaving(true);
          void drafts.deleteDraft(project.id, draft.id);
          router.back();
        },
      },
    ]);
  };

  async function runConvert() {
    if (!project || !draft) return;
    setConvertError(null);
    setConverting(true);
    try {
      const result = await drafts.convertDraft(project.id, draft.id);
      if (result.ok) {
        // The product takes this screen's place, so back returns to the list of drafts.
        router.replace({ pathname: "/projects/[id]/products/[productId]", params: { id: project.id, productId: result.productId } });
      } else {
        setConvertError(t(convertErrorKey(result.code), { name: result.name ?? draft.name }));
      }
    } catch {
      setConvertError(t(convertErrorKey("internal_error")));
    } finally {
      setConverting(false);
    }
  }

  const confirmConvert = () => {
    if (!base || converting) return;
    // A same-name ingredient counted a different way: the server would refuse, so say so here instead.
    if (split.mismatch.length > 0) {
      setConvertError(t("drafts.convertErrors.modeMismatch", { name: split.mismatch[0] }));
      return;
    }
    const others = draft.sizes.filter((s) => s !== base);
    const priceText = draft.expectedPrice === null ? null : moneyOf(draft.expectedPrice, currency);
    const productLine =
      others.length > 0
        ? priceText === null
          ? t("drafts.confirmMultiNoPrice", { sizes: joinNames(draft.sizes, t("drafts.and")), base, others: joinNames(others, t("drafts.and")) })
          : t("drafts.confirmMulti", { sizes: joinNames(draft.sizes, t("drafts.and")), base, others: joinNames(others, t("drafts.and")), price: priceText })
        : priceText === null
          ? t("drafts.confirmOneNoPrice", { base })
          : t("drafts.confirmOne", { base, price: priceText });
    const message = [
      split.create.length > 0 ? t("drafts.confirmAdd", { names: split.create.join(", ") }) : null,
      split.reuse.length > 0
        ? t("drafts.confirmReuse", {
            names: reuseTexts(
              split.reuse,
              currency,
              (name, price) => t("drafts.confirmReuseItem", { name, price }),
              (purchase) => t(`ingredients.units.${baseUnitOf(purchase.unit)}`),
            ).join("; "),
          })
        : null,
      productLine,
      t("drafts.confirmReadOnly"),
    ]
      .filter(Boolean)
      .join("\n");
    Alert.alert(t("drafts.confirmTitle", { name: draft.name }), message, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("drafts.confirmAction"), onPress: () => void runConvert() },
    ]);
  };

  const amountIngredient = sheet?.kind === "amount" ? lookup.get(sheet.ingredientId) : undefined;
  const amountLine = sheet?.kind === "amount" && sheet.lineId ? draft.lines.find((l) => l.id === sheet.lineId) : undefined;

  const recipeTitle = converted ? t("drafts.recipeConvertedTitle", { count: draft.lines.length }) : t("drafts.recipeTitle", { size: base ?? "", count: draft.lines.length });
  const statusColor = done ? colors.success : colors.text;
  const rowStyle = { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing[1], minHeight: layout.controlHeight };

  const statusRow = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
      <Text style={[typography.bodyStrong, { color: statusColor }]}>{t(done ? "drafts.statusDone" : "drafts.statusWorking")}</Text>
      {converted ? null : <Ionicons name="chevron-down" size={iconSize.sm} color={colors.textSecondary} />}
    </View>
  );

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          title: t("drafts.detailTitle"),
          headerRight: () => (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={converted ? t("drafts.menuDelete") : t("drafts.editLink")}
              onPress={converted ? confirmDelete : () => setSheet({ kind: "menu" })}
              style={{ minHeight: layout.controlHeight, justifyContent: "center", paddingHorizontal: spacing[1] }}
            >
              <Text style={[typography.bodyStrong, { color: converted ? colors.danger : colors.accentStrong }]}>
                {converted ? t("drafts.menuDelete") : t("drafts.editLink")}
              </Text>
            </PressableScale>
          ),
        }}
      />
      <OfflineNote />
      <DraftRejectedNoticeView />
      {convertError ? (
        <View accessibilityRole="alert" style={{ padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.dangerBg }}>
          <Text style={[typography.bodyStrong, { color: colors.danger }]}>{convertError}</Text>
        </View>
      ) : null}
      <Enter index={1}>
        <View style={{ gap: spacing[2] }}>
          {converted ? (
            <LinkCard
              caption={t("drafts.convertedCard", { date: when ? t("ingredients.history.date", { day: when.getDate(), month: when.getMonth() + 1 }) : "" })}
              title={draft.productId ? product?.name : t("drafts.convertedGone")}
              onPress={draft.productId ? () => once(() => router.push({ pathname: "/projects/[id]/products/[productId]", params: { id: project.id, productId: draft.productId as string } })) : undefined}
            />
          ) : null}
          <Text accessibilityRole="header" style={[typography.screenTitle, { color: colors.text }]}>
            {draft.name}
          </Text>
          {pending ? <Hint>{t("drafts.pending")}</Hint> : null}
          <Card>
            <View style={{ gap: spacing[0] }}>
              {converted ? (
                <View accessible accessibilityLabel={`${t("drafts.statusRow")}, ${t("drafts.statusDone")}`} style={rowStyle}>
                  <Text style={[typography.label, { color: colors.textSecondary }]}>{t("drafts.statusRow")}</Text>
                  {statusRow}
                </View>
              ) : (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`${t("drafts.statusRow")}, ${t(done ? "drafts.statusDone" : "drafts.statusWorking")}`}
                  onPress={() => setSheet({ kind: "status" })}
                  style={rowStyle}
                >
                  <Text style={[typography.label, { color: colors.textSecondary }]}>{t("drafts.statusRow")}</Text>
                  {statusRow}
                </PressableScale>
              )}
              {converted ? (
                <View accessible accessibilityLabel={`${t("drafts.sizeRow")}, ${sizeLine}`} style={rowStyle}>
                  <Text style={[typography.label, { color: colors.textSecondary }]}>{t("drafts.sizeRow")}</Text>
                  <Text style={[typography.body, { color: colors.text, flexShrink: 1, textAlign: "right" }]}>{sizeLine}</Text>
                </View>
              ) : (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`${t("drafts.sizeRow")}, ${sizeLine}`}
                  onPress={() => setSheet({ kind: "sizes" })}
                  style={rowStyle}
                >
                  <Text style={[typography.label, { color: colors.textSecondary }]}>{t("drafts.sizeRow")}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0], flexShrink: 1 }}>
                    <Text style={[typography.body, { color: colors.text, flexShrink: 1, textAlign: "right" }]}>{sizeLine}</Text>
                    <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} />
                  </View>
                </PressableScale>
              )}
            </View>
          </Card>
          {draft.note !== "" ? <Text style={[typography.body, { color: colors.textSecondary }]}>{draft.note}</Text> : null}

          {!converted && done && estimate.total !== null && base ? <DraftHero size={base} estimate={estimate} price={draft.expectedPrice} currency={currency} /> : null}

          <DraftRecipe
            title={recipeTitle}
            lines={draft.lines}
            ingredients={ingredientList}
            currency={currency}
            recipeCost={done || converted ? (estimate.total === null ? null : estimate.recipeCost) : null}
            defaultOpen={!done && !converted}
            onOpenLine={converted ? undefined : openLine}
            onAdd={converted ? undefined : () => setSheet({ kind: "add" })}
          />

          {converted ? (
            <Hint>{t("drafts.convertedHint")}</Hint>
          ) : done ? (
            <>
              {split.create.length > 0 ? <Hint>{t("drafts.willCreate", { count: split.create.length, names: split.create.join(", ") })}</Hint> : null}
              {missingHint ? <Hint>{missingHint}</Hint> : null}
              <Button label={t("drafts.convert")} loading={converting} onPress={confirmConvert} />
            </>
          ) : draft.lines.length > 0 && base ? (
            estimate.total === null ? (
              <Hint>{missingHint}</Hint>
            ) : (
              <Hint>
                {[
                  t("drafts.hintEstimate", { size: base, cost: moneyOf(estimate.total, currency) }),
                  estimate.profit !== null && estimate.marginPct !== null ? t("drafts.hintProfit", { profit: moneyOf(estimate.profit, currency), pct: estimate.marginPct }) : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
              </Hint>
            )
          ) : null}
        </View>
      </Enter>

      {sheet?.kind === "menu" ? (
        <DraftMenuSheet onRename={() => setSheet({ kind: "rename" })} onNote={() => setSheet({ kind: "note" })} onDelete={confirmDelete} onClose={close} />
      ) : null}
      {sheet?.kind === "rename" ? (
        <TextSheet kind="name" initial={draft.name} onSave={async (name) => (name === draft.name ? true : (await drafts.editDraft(project.id, draft.id, { name })).ok)} onClose={close} />
      ) : null}
      {sheet?.kind === "note" ? (
        <TextSheet kind="note" initial={draft.note} onSave={async (note) => (note === draft.note ? true : (await drafts.editDraft(project.id, draft.id, { note })).ok)} onClose={close} />
      ) : null}
      {sheet?.kind === "sizes" ? (
        <SizesPriceSheet
          initialSizes={draft.sizes}
          initialPrice={draft.expectedPrice}
          currency={currency}
          onSave={async (sizes, price) => {
            const fields: { sizes?: typeof sizes; expectedPrice?: number | null } = {};
            if (sizes.join() !== draft.sizes.join()) fields.sizes = sizes;
            if (price !== draft.expectedPrice) fields.expectedPrice = price;
            return Object.keys(fields).length === 0 ? true : (await drafts.editDraft(project.id, draft.id, fields)).ok;
          }}
          onClose={close}
        />
      ) : null}
      {sheet?.kind === "status" ? (
        <StatusSheet
          status={draft.status}
          missing={missing}
          onChoose={async (next) => (await drafts.setDraftStatus(project.id, draft.id, next)).ok}
          onOpenMissing={openMissing}
          onClose={close}
        />
      ) : null}
      {sheet?.kind === "add" ? (
        <AddLineSheet
          ingredients={ingredientList}
          usedIds={usedIds}
          usedNames={usedNames}
          currency={currency}
          onAddExisting={(ingredient) => setSheet({ kind: "amount", ingredientId: ingredient.id, lineId: null })}
          onAddNew={(name) => {
            close();
            openLineScreen(undefined, name);
          }}
          onClose={close}
        />
      ) : null}
      {sheet?.kind === "amount" && amountIngredient ? (
        <LineSheet
          ingredient={amountIngredient}
          sizeLabel={base ?? ""}
          initial={amountLine?.amount ?? 0}
          isDefault={false}
          currency={currency}
          onSave={async (amount) =>
            sheet.lineId
              ? (await drafts.editLine(project.id, draft.id, sheet.lineId, { amount })).ok
              : (await drafts.addLine(project.id, draft.id, { kind: "existing", ingredientId: amountIngredient.id, amount })).ok
          }
          onRemove={
            sheet.lineId
              ? () => {
                  const lineId = sheet.lineId as string;
                  close();
                  void drafts.removeLine(project.id, draft.id, lineId);
                }
              : undefined
          }
          onClose={close}
        />
      ) : null}
    </Screen>
  );
}
