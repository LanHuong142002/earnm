import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DraftRowView } from "../../../../../../drafts/DraftRow";
import { DraftRejectedNoticeView } from "../../../../../../drafts/DraftRejectedNotice";
import { useDrafts } from "../../../../../../drafts/DraftsProvider";
import { draftEstimate } from "../../../../../../drafts/estimate";
import type { Draft } from "../../../../../../drafts/types";
import { estimateLines, groupDrafts, rowSummary } from "../../../../../../drafts/view";
import { moneyOf } from "../../../../../../ingredients/display";
import { useIngredients } from "../../../../../../ingredients/IngredientsProvider";
import { OfflineNote } from "../../../../../../projects/OfflineNote";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useGoToProjectList, useTapOnce } from "../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../projects/routing";
import { useProducts } from "../../../../../../products/ProductsProvider";
import { nextLoadState, taskListState, type LoadState } from "../../../../../../tasks/listState";
import { useTheme } from "../../../../../../theme/useTheme";
import { Button } from "../../../../../../ui/Button";
import { Card } from "../../../../../../ui/Card";
import { Collapsible } from "../../../../../../ui/Collapsible";
import { Enter } from "../../../../../../ui/Enter";
import { PressableScale } from "../../../../../../ui/PressableScale";
import { Screen } from "../../../../../../ui/Screen";

export default function DraftListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const once = useTapOnce();
  const focused = useIsFocused();
  const { colors, typography, radius, spacing, layout, iconSize } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const drafts = useDrafts();
  const { ready, refresh, draftsFor, draftPendingFor, loadedFor } = drafts;
  const products = useProducts();
  const ingredients = useIngredients();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const [load, setLoad] = useState<LoadState>({ loaded: false, failed: false, reason: null });
  const { ready: ingredientsReady, refresh: refreshIngredients } = ingredients;
  const { ready: productsReady, refresh: refreshProducts } = products;

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  const fetchAll = useCallback(() => {
    if (!ready || !id) return;
    void refresh(id)
      .catch(() => "error" as const)
      .then((result) => setLoad((prev) => nextLoadState(prev, result)));
    // The estimates follow the ingredients' prices and the default extra costs, so they are fetched as well.
    if (ingredientsReady) void refreshIngredients(id).catch(() => undefined);
    if (productsReady) void refreshProducts(id).catch(() => undefined);
  }, [ready, refresh, id, ingredientsReady, refreshIngredients, productsReady, refreshProducts]);
  useFocusEffect(fetchAll);

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

  const currency = project.currency;
  const all = ready ? draftsFor(project.id) : [];
  const ingredientList = ingredientsReady ? ingredients.ingredientsFor(project.id) : [];
  const extras = productsReady ? products.extraCostsFor(project.id) : [];
  const target = productsReady ? products.targetMarginFor(project.id) : 65;
  const groups = groupDrafts(all);
  const pending = draftPendingFor(project.id);
  const listState = taskListState({ ready, cachedCount: all.length, loaded: load.loaded || (ready && loadedFor(project.id)), failed: load.failed });
  const openDraft = (draftId: string) => once(() => router.push({ pathname: "/projects/[id]/drafts/[draftId]", params: { id: project.id, draftId } }));
  const addDraft = () => once(() => router.push({ pathname: "/projects/[id]/drafts/new", params: { id: project.id } }));

  const summaryOf = (draft: Draft) => {
    const sum = rowSummary(draft, draftEstimate({ lines: estimateLines(draft.lines), ingredients: ingredientList, extraCosts: extras, expectedPrice: draft.expectedPrice, targetMargin: target }));
    const sizes = draft.sizes.join(", ");
    if (sum.kind === "noRecipe") return t("drafts.rowNoRecipe");
    if (sum.kind === "missing") return t("drafts.rowMissing", { sizes, count: sum.count });
    return t("drafts.rowCost", { sizes, cost: moneyOf(sum.total, currency) });
  };

  const section = (title: string, rows: Draft[]) => (
    <View style={{ gap: spacing[1] }}>
      <Text accessibilityRole="header" style={[typography.label, { color: colors.textSecondary }]}>
        {title}
      </Text>
      <Card flush>
        <View style={{ paddingHorizontal: spacing[2] }}>
          {rows.map((draft, index) => (
            <DraftRowView
              key={draft.id}
              name={draft.name}
              status={draft.status}
              summary={summaryOf(draft)}
              pending={pending.has(draft.id)}
              divider={index > 0}
              onOpen={() => openDraft(draft.id)}
            />
          ))}
        </View>
      </Card>
    </View>
  );

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <PressableScale
              accessibilityRole="link"
              accessibilityLabel={t("drafts.addLink")}
              onPress={addDraft}
              style={{ minHeight: layout.controlHeight, justifyContent: "center", paddingHorizontal: spacing[1] }}
            >
              <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("drafts.addLink")}</Text>
            </PressableScale>
          ),
        }}
      />
      <OfflineNote />
      <DraftRejectedNoticeView />
      <Enter index={2}>
        {listState === "error" ? (
          <View accessibilityRole="alert" style={{ gap: spacing[0], padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.dangerBg }}>
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>{t(load.reason === "offline" ? "drafts.loadError" : "drafts.loadErrorServer")}</Text>
            {load.reason === "offline" ? <Text style={[typography.label, { color: colors.danger }]}>{t("home.offline")}</Text> : null}
            <Button label={t("drafts.loadRetry")} variant="secondary" onPress={fetchAll} />
          </View>
        ) : listState === "loading" ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: spacing[1] }}>
            {[0, 1, 2].map((n) => (
              <View key={n} style={{ height: layout.controlHeight + spacing[3], borderRadius: radius.card, backgroundColor: colors.field }} />
            ))}
          </View>
        ) : all.length === 0 ? (
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
              <Ionicons name="create-outline" size={iconSize.xl} color={colors.accent} />
            </View>
            <View style={{ gap: spacing[0], alignItems: "center" }}>
              <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text, textAlign: "center" }]}>
                {t("drafts.emptyTitle")}
              </Text>
              <Text style={[typography.body, { color: colors.textSecondary, textAlign: "center" }]}>{t("drafts.emptyBody")}</Text>
            </View>
            <Button label={t("drafts.emptyAdd")} variant="secondary" onPress={addDraft} />
          </View>
        ) : (
          <View style={{ gap: spacing[2] }}>
            {groups.done.length > 0 ? section(t("drafts.sectionDone", { count: groups.done.length }), groups.done) : null}
            {groups.working.length > 0 ? section(t("drafts.sectionWorking", { count: groups.working.length }), groups.working) : null}
            {groups.converted.length > 0 ? (
              <Card flush>
                <View style={{ paddingHorizontal: spacing[2] }}>
                  <Collapsible title={t("drafts.sectionConverted", { count: groups.converted.length })}>
                    {groups.converted.map((draft, index) => (
                      <DraftRowView
                        key={draft.id}
                        name={draft.name}
                        status={draft.status}
                        summary={summaryOf(draft)}
                        pending={pending.has(draft.id)}
                        divider={index > 0}
                        onOpen={() => openDraft(draft.id)}
                      />
                    ))}
                  </Collapsible>
                </View>
              </Card>
            ) : null}
          </View>
        )}
      </Enter>
    </Screen>
  );
}
