import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useIngredients } from "../../../../../../ingredients/IngredientsProvider";
import { OfflineNote } from "../../../../../../projects/OfflineNote";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useGoToProjectList, useTapOnce } from "../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../projects/routing";
import { ProductRejectedNotice } from "../../../../../../products/ProductRejectedNotice";
import { ProductRowView } from "../../../../../../products/ProductRow";
import { useProducts } from "../../../../../../products/ProductsProvider";
import { ingredientLookup, productRows } from "../../../../../../products/view";
import { nextLoadState, taskListState, type LoadState } from "../../../../../../tasks/listState";
import { useTheme } from "../../../../../../theme/useTheme";
import { Button } from "../../../../../../ui/Button";
import { Card } from "../../../../../../ui/Card";
import { Enter } from "../../../../../../ui/Enter";
import { PressableScale } from "../../../../../../ui/PressableScale";
import { Screen } from "../../../../../../ui/Screen";

export default function ProductListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const once = useTapOnce();
  const focused = useIsFocused();
  const { colors, typography, radius, spacing, layout, iconSize } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const { ready, refresh, productsFor, extraCostsFor, targetMarginFor, pendingFor, loadedFor } = useProducts();
  const ingredients = useIngredients();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const [load, setLoad] = useState<LoadState>({ loaded: false, failed: false, reason: null });
  const { ready: ingredientsReady, refresh: refreshIngredients } = ingredients;

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  const fetchAll = useCallback(() => {
    if (!ready || !id) return;
    void refresh(id)
      .catch(() => "error" as const)
      .then((result) => setLoad((prev) => nextLoadState(prev, result)));
    // Costs follow the ingredients' current prices, so they are fetched as well.
    if (ingredientsReady) void refreshIngredients(id).catch(() => undefined);
  }, [ready, refresh, id, ingredientsReady, refreshIngredients]);
  useFocusEffect(fetchAll);

  const projectId = project?.id ?? "";
  const currency = project?.currency ?? "VND";
  const all = ready && project ? productsFor(projectId) : [];
  const ingredientList = ingredientsReady && project ? ingredients.ingredientsFor(projectId) : [];
  const target = project ? targetMarginFor(projectId) : 65;
  const rows = productRows(all, ingredientLookup(ingredientList), target, currency);

  if (!project) {
    return (
      <Screen edges={[]}>
        {view === "loading" ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ height: layout.controlHeight, width: "60%", borderRadius: radius.field, backgroundColor: colors.field }}
          />
        ) : null}
      </Screen>
    );
  }

  const pending = pendingFor(project.id);
  const extras = extraCostsFor(project.id);
  const listState = taskListState({
    ready,
    cachedCount: all.length,
    loaded: load.loaded || (ready && loadedFor(project.id)),
    failed: load.failed,
  });
  const openProduct = (productId: string) => once(() => router.push({ pathname: "/projects/[id]/products/[productId]", params: { id: project.id, productId } }));
  const addProduct = () => once(() => router.push({ pathname: "/projects/[id]/products/new", params: { id: project.id } }));
  const openExtras = () => once(() => router.push({ pathname: "/projects/[id]/products/extra-costs", params: { id: project.id } }));
  const openIngredients = () => once(() => router.push({ pathname: "/projects/[id]/ingredients", params: { id: project.id } }));
  const extraNames = extras.map((x) => x.name).join(", ");

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <PressableScale
              accessibilityRole="link"
              accessibilityLabel={t("products.newProduct")}
              onPress={addProduct}
              style={{ minHeight: layout.controlHeight, justifyContent: "center", paddingHorizontal: spacing[1] }}
            >
              <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("products.addLink")}</Text>
            </PressableScale>
          ),
        }}
      />
      <OfflineNote />
      <ProductRejectedNotice />
      <Enter index={2}>
        {listState === "error" ? (
          <View accessibilityRole="alert" style={{ gap: spacing[0], padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.dangerBg }}>
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>
              {t(load.reason === "offline" ? "products.loadError" : "products.loadErrorServer")}
            </Text>
            {load.reason === "offline" ? <Text style={[typography.label, { color: colors.danger }]}>{t("home.offline")}</Text> : null}
            <Button label={t("products.loadRetry")} variant="secondary" onPress={fetchAll} />
          </View>
        ) : listState === "loading" ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: spacing[1] }}>
            <View style={{ height: layout.controlHeight + spacing[2], borderRadius: radius.card, backgroundColor: colors.field }} />
            {[0, 1, 2].map((n) => (
              <View key={n} style={{ height: layout.controlHeight + spacing[3], borderRadius: radius.card, backgroundColor: colors.field }} />
            ))}
          </View>
        ) : (
          <View style={{ gap: spacing[2] }}>
            <Card flush>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={extraNames ? t("products.extraCostsRowA11y", { names: extraNames }) : t("products.extraCostsRow")}
                onPress={openExtras}
                style={{ flexDirection: "row", alignItems: "center", gap: spacing[1], minHeight: layout.controlHeight + spacing[2], paddingHorizontal: spacing[2] }}
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
                  <Ionicons name="snow-outline" size={iconSize.sm} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyStrong, { color: colors.text }]}>{t("products.extraCostsRow")}</Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                    {extraNames || t("products.extraCostsRowNone")}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} />
              </PressableScale>
            </Card>
            {rows.length === 0 ? (
              <View style={{ alignItems: "center", gap: spacing[2], paddingTop: spacing[4] }}>
                <View
                  style={{
                    width: iconSize.xl * 2,
                    height: iconSize.xl * 2,
                    borderRadius: radius.tile,
                    borderWidth: 1,
                    borderColor: colors.tileBorder,
                    backgroundColor: colors.tile,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="cafe-outline" size={iconSize.xl} color={colors.accent} />
                </View>
                <View style={{ gap: spacing[0], alignItems: "center" }}>
                  <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text, textAlign: "center" }]}>
                    {t("products.emptyTitle")}
                  </Text>
                  <Text style={[typography.body, { color: colors.textSecondary, textAlign: "center" }]}>{t("products.emptyBody")}</Text>
                </View>
                <Button label={t("products.emptyAdd")} variant="secondary" onPress={addProduct} />
                {ingredientList.length === 0 ? (
                  <PressableScale
                    accessibilityRole="link"
                    accessibilityLabel={t("products.emptyIngredients")}
                    onPress={openIngredients}
                    style={{ minHeight: layout.controlHeight, justifyContent: "center" }}
                  >
                    <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("products.emptyIngredients")}</Text>
                  </PressableScale>
                ) : null}
              </View>
            ) : (
              <Card flush>
                <View style={{ paddingHorizontal: spacing[2] }}>
                  {rows.map((row, index) => (
                    <ProductRowView
                      key={row.id}
                      row={row}
                      currency={project.currency}
                      target={target}
                      pending={pending.has(row.id)}
                      divider={index > 0}
                      onOpen={() => openProduct(row.id)}
                    />
                  ))}
                </View>
              </Card>
            )}
          </View>
        )}
      </Enter>
    </Screen>
  );
}
