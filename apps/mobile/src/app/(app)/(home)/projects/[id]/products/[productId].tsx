import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { moneyOf } from "../../../../../../ingredients/display";
import { useIngredients } from "../../../../../../ingredients/IngredientsProvider";
import { OfflineNote } from "../../../../../../projects/OfflineNote";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useGoToProjectList, useTapOnce } from "../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../projects/routing";
import { latestPriceUpdate } from "../../../../../../products/cost";
import { MenuSheet, RenameSheet, SizesSheet } from "../../../../../../products/MenuSheets";
import { PriceHint, PriceSheet, TargetSheet } from "../../../../../../products/PriceSheets";
import { Hint } from "../../../../../../products/ProductBits";
import { ProductRejectedNotice } from "../../../../../../products/ProductRejectedNotice";
import { useProducts } from "../../../../../../products/ProductsProvider";
import { RecipeSections } from "../../../../../../products/RecipeSections";
import { ExtraAmountSheet, ExtraPickerSheet, IngredientPickerSheet, LineSheet } from "../../../../../../products/RecipeSheets";
import {
  addExtra,
  addLine,
  extrasToAdd,
  recipeOf,
  removeExtra,
  removeLine,
  setExtraAmount,
  setLineAmount,
  toggleExtra,
  toggleLine,
} from "../../../../../../products/recipeEdit";
import type { SizeName } from "../../../../../../products/types";
import { fixedCostState, ingredientLookup, pickSize, sizeFigures, withPriceChanges } from "../../../../../../products/view";
import { useTheme } from "../../../../../../theme/useTheme";
import { Card } from "../../../../../../ui/Card";
import { Enter } from "../../../../../../ui/Enter";
import { HeroCard } from "../../../../../../ui/HeroCard";
import { PressableScale } from "../../../../../../ui/PressableScale";
import { Screen } from "../../../../../../ui/Screen";
import { Segmented } from "../../../../../../ui/Segmented";

type Sheet =
  | { kind: "menu" }
  | { kind: "rename" }
  | { kind: "sizes" }
  | { kind: "price" }
  | { kind: "target" }
  | { kind: "picker" }
  | { kind: "line"; ingredientId: string; adding: boolean }
  | { kind: "extra"; extraId: string }
  | { kind: "extraPicker" };

export default function ProductScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const once = useTapOnce();
  const focused = useIsFocused();
  const { colors, typography, spacing, layout, iconSize } = useTheme();
  const { id, productId } = useLocalSearchParams<{ id: string; productId: string }>();
  const { status, projects } = useProjects();
  const products = useProducts();
  const ingredients = useIngredients();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const [wanted, setWanted] = useState<SizeName | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [leaving, setLeaving] = useState(false);
  const { ready, refresh, productsFor, extraCostsFor, targetMarginFor, pendingFor, loadedFor, perCupShareFor, fixedTotalFor, expectedCupsFor } = products;
  const { ready: ingredientsReady, refresh: refreshIngredients } = ingredients;

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  // Costs follow the ingredients' current prices, so both lists are fetched when the screen comes back.
  useFocusEffect(
    useCallback(() => {
      if (!ready || !id) return;
      void refresh(id).catch(() => undefined);
      if (ingredientsReady) void refreshIngredients(id).catch(() => undefined);
    }, [ready, refresh, id, ingredientsReady, refreshIngredients]),
  );

  const projectId = project?.id ?? "";
  const currency = project?.currency ?? "VND";
  const product = ready && project ? (productsFor(projectId).find((p) => p.id === productId) ?? null) : null;
  const ingredientList = ingredientsReady && project ? ingredients.ingredientsFor(projectId) : [];
  const lookup = ingredientLookup(ingredientList);
  const target = project ? targetMarginFor(projectId) : 65;
  const sizeName = product ? pickSize(product.sizes.map((s) => s.size), wanted) : null;
  const size = product?.sizes.find((s) => s.size === sizeName) ?? null;
  const share = project ? perCupShareFor(projectId) : null;
  const fixedTotal = project ? fixedTotalFor(projectId) : 0;
  const cups = project ? expectedCupsFor(projectId) : null;
  const fixedState = fixedCostState(fixedTotal, share);
  const figures = size ? sizeFigures(size, lookup, target, currency, share) : null;

  if (!project) return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;
  if (!product || !size || !figures || !sizeName) {
    return (
      <Screen edges={[]}>
        <OfflineNote />
        <ProductRejectedNotice />
        {ready && loadedFor(project.id) && !leaving ? (
          <Text accessibilityRole="alert" style={[typography.body, { color: colors.textSecondary }]}>
            {t("products.notFound")}
          </Text>
        ) : null}
      </Screen>
    );
  }

  const pending = pendingFor(project.id).has(product.id);
  const sizeNames = product.sizes.map((s) => s.size);
  const close = () => setSheet(null);
  const saveRecipe = async (next: ReturnType<typeof recipeOf>) => (await products.setLines(project.id, product.id, size.size, next)).ok;
  const recipe = recipeOf(size);
  const changed = latestPriceUpdate(size.lines, withPriceChanges(lookup));
  const when = changed ? new Date(changed.date) : null;
  const names = productsFor(project.id).filter((p) => p.id !== product.id).map((p) => p.name);

  const confirmDelete = () => {
    close();
    Alert.alert(t("products.deleteTitle", { name: product.name }), t("products.deleteMessage", { count: product.sizes.length }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("products.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          setLeaving(true);
          void products.remove(project.id, product.id);
          router.back();
        },
      },
    ]);
  };

  const profitLine = figures.price !== null && figures.profit !== null;
  const sheetLineIngredient = sheet?.kind === "line" ? lookup[sheet.ingredientId] : undefined;
  const sheetLine = sheet?.kind === "line" ? size.lines.find((l) => l.ingredientId === sheet.ingredientId) : undefined;
  const sheetExtra = sheet?.kind === "extra" ? size.extras.find((x) => x.id === sheet.extraId) : undefined;
  const heroSub = profitLine
    ? [
        figures.margin === null ? null : t("products.heroMargin", { pct: figures.margin }),
        fixedState === "share" ? t("products.heroFixedIncluded") : fixedState === "unset" ? t("products.heroFixedExcluded") : null,
        figures.belowTarget ? t("products.belowTarget", { pct: target }) : null,
      ]
        .filter(Boolean)
        .join(" ")
    : t("products.heroNoPrice");
  const heroCostLabel = t(fixedState === "share" ? "products.heroCostFull" : fixedState === "unset" ? "products.heroCostItem" : "products.heroCostShort");

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          title: product.name,
          headerRight: () => (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t("products.menuA11y")}
              onPress={() => setSheet({ kind: "menu" })}
              style={{ minWidth: layout.controlHeight, minHeight: layout.controlHeight, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={colors.accentStrong} />
            </PressableScale>
          ),
        }}
      />
      <OfflineNote />
      <ProductRejectedNotice />
      <Enter index={1}>
        <View style={{ gap: spacing[2] }}>
          {sizeNames.length > 1 ? (
            <Segmented
              accessibilityLabel={t("products.sizePicker")}
              options={sizeNames.map((s) => ({ value: s, label: s }))}
              value={size.size}
              onChange={setWanted}
            />
          ) : null}
          {pending ? <Hint>{t("products.pending")}</Hint> : null}
          <HeroCard
            accessibilityLabel={
              profitLine
                ? `${t("products.heroProfit", { size: size.size })}, ${moneyOf(figures.profit ?? 0, currency)}`
                : `${t("products.heroCost", { size: size.size })}, ${moneyOf(figures.fullCost, currency)}`
            }
            label={t(profitLine ? "products.heroProfit" : "products.heroCost", { size: size.size })}
            value={moneyOf(profitLine ? (figures.profit ?? 0) : figures.fullCost, currency)}
            sub={heroSub}
            cells={
              profitLine
                ? [
                    { label: t("products.heroPrice"), value: moneyOf(figures.price ?? 0, currency) },
                    { label: heroCostLabel, value: moneyOf(figures.fullCost, currency) },
                  ]
                : undefined
            }
          />
          <Card flush>
            <View style={{ paddingHorizontal: spacing[2] }}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`${t("products.priceRow")}, ${figures.price === null ? t("products.setPrice") : moneyOf(figures.price, currency)}`}
                onPress={() => setSheet({ kind: "price" })}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[1], minHeight: layout.controlHeight + spacing[0] }}
              >
                <Text style={[typography.body, { color: colors.text }]}>{t("products.priceRow")}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
                  <Text style={[typography.bodyStrong, { color: figures.price === null ? colors.accentStrong : colors.text }]}>
                    {figures.price === null ? t("products.setPrice") : moneyOf(figures.price, currency)}
                  </Text>
                  <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} />
                </View>
              </PressableScale>
              <PriceHint cost={figures.fullCost} target={target} currency={currency} onPress={() => setSheet({ kind: "target" })} />
            </View>
          </Card>
          <RecipeSections
            size={size}
            figures={figures}
            ingredients={lookup}
            currency={currency}
            fixed={{ state: fixedState, share, total: fixedTotal, cups }}
            onOpenFixed={() => once(() => router.push({ pathname: "/projects/[id]/fixed-costs", params: { id: project.id } }))}
            onToggleLine={(ingredientId) => void saveRecipe(toggleLine(recipe, ingredientId))}
            onOpenLine={(ingredientId) => setSheet({ kind: "line", ingredientId, adding: false })}
            onAddLine={() => setSheet({ kind: "picker" })}
            onToggleExtra={(extraId) => void saveRecipe(toggleExtra(recipe, extraId))}
            onOpenExtra={(extraId) => setSheet({ kind: "extra", extraId })}
            onAddExtra={() => setSheet({ kind: "extraPicker" })}
          />
          {changed && when ? (
            <Hint>{t("products.priceUpdated", { date: t("ingredients.history.date", { day: when.getDate(), month: when.getMonth() + 1 }), name: changed.ingredientName })}</Hint>
          ) : null}
        </View>
      </Enter>

      {sheet?.kind === "menu" ? (
        <MenuSheet
          onClose={close}
          onRename={() => setSheet({ kind: "rename" })}
          onSizes={() => setSheet({ kind: "sizes" })}
          onDelete={confirmDelete}
        />
      ) : null}
      {sheet?.kind === "rename" ? (
        <RenameSheet initial={product.name} others={names} onClose={close} onSave={async (name) => (await products.rename(project.id, product.id, name)).ok} />
      ) : null}
      {sheet?.kind === "sizes" ? (
        <SizesSheet initial={sizeNames} onClose={close} onSave={async (sizes) => (await products.setSizes(project.id, product.id, sizes)).ok} />
      ) : null}
      {sheet?.kind === "price" ? (
        <PriceSheet
          sizeLabel={size.size}
          currency={currency}
          initial={size.sellingPrice}
          cost={figures.cost}
          share={share}
          target={target}
          onClose={close}
          onSave={async (price) => (await products.setPrice(project.id, product.id, size.size, price)).ok}
          onSaveTarget={async (value) => (await products.setTargetMargin(project.id, value)).ok}
        />
      ) : null}
      {sheet?.kind === "target" ? (
        <TargetSheet initial={target} onClose={close} onSave={async (value) => (await products.setTargetMargin(project.id, value)).ok} />
      ) : null}
      {sheet?.kind === "picker" ? (
        <IngredientPickerSheet
          ingredients={ingredientList}
          taken={new Set(size.lines.map((l) => l.ingredientId))}
          sizeLabel={size.size}
          currency={currency}
          onClose={close}
          onPick={(item) => setSheet({ kind: "line", ingredientId: item.id, adding: true })}
          onNew={() => {
            close();
            once(() => router.push({ pathname: "/projects/[id]/ingredients/new", params: { id: project.id } }));
          }}
        />
      ) : null}
      {sheet?.kind === "line" && sheetLineIngredient ? (
        <LineSheet
          ingredient={sheetLineIngredient}
          sizeLabel={size.size}
          currency={currency}
          initial={sheetLine?.amount ?? 0}
          isDefault={sheetLine?.isDefault ?? false}
          onClose={close}
          onSave={(amount) => saveRecipe(sheet.adding ? addLine(recipe, sheet.ingredientId, amount) : setLineAmount(recipe, sheet.ingredientId, amount))}
          onRemove={
            sheet.adding || !sheetLine || sheetLine.isDefault
              ? undefined
              : () => {
                  void saveRecipe(removeLine(recipe, sheet.ingredientId));
                  close();
                }
          }
        />
      ) : null}
      {sheet?.kind === "extra" && sheetExtra ? (
        <ExtraAmountSheet
          name={sheetExtra.name}
          sizeLabel={size.size}
          currency={currency}
          initial={sheetExtra.amount}
          onClose={close}
          onSave={(amount) => saveRecipe(setExtraAmount(recipe, sheetExtra.id, amount))}
          onRemove={
            sheetExtra.isDefault
              ? undefined
              : () => {
                  void saveRecipe(removeExtra(recipe, sheetExtra.id));
                  close();
                }
          }
        />
      ) : null}
      {sheet?.kind === "extraPicker" ? (
        <ExtraPickerSheet
          extraCosts={extrasToAdd(recipe, extraCostsFor(project.id))}
          sizeLabel={size.size}
          currency={currency}
          onClose={close}
          onPick={(extra) => {
            void saveRecipe(addExtra(recipe, product.id, size.size, extra));
            close();
          }}
          onManage={() => {
            close();
            once(() => router.push({ pathname: "/projects/[id]/products/extra-costs", params: { id: project.id } }));
          }}
        />
      ) : null}
    </Screen>
  );
}
