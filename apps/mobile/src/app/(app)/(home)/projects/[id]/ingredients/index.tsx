import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { totalSpent } from "../../../../../../ingredients/cost";
import { moneyOf } from "../../../../../../ingredients/display";
import { IngredientRejectedNotice } from "../../../../../../ingredients/IngredientRejectedNotice";
import { IngredientRow } from "../../../../../../ingredients/IngredientRow";
import { useIngredients } from "../../../../../../ingredients/IngredientsProvider";
import { sortIngredients } from "../../../../../../ingredients/order";
import type { Ingredient } from "../../../../../../ingredients/types";
import { OfflineNote } from "../../../../../../projects/OfflineNote";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useGoToProjectList, useTapOnce } from "../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../projects/routing";
import { nextLoadState, taskListState, type LoadState } from "../../../../../../tasks/listState";
import { useTheme } from "../../../../../../theme/useTheme";
import { Button } from "../../../../../../ui/Button";
import { Card } from "../../../../../../ui/Card";
import { Enter } from "../../../../../../ui/Enter";
import { PressableScale } from "../../../../../../ui/PressableScale";
import { Screen } from "../../../../../../ui/Screen";

export default function IngredientListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const once = useTapOnce();
  const focused = useIsFocused();
  const { colors, typography, radius, spacing, layout, iconSize, onFixed } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const { ready, refresh, ingredientsFor, pendingFor, loadedFor } = useIngredients();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);

  // "loaded" only after a refresh answered "ok"; "failed" after a network or server error.
  // The first load shows blocks, a failed first load shows an error, never "no ingredients".
  const [load, setLoad] = useState<LoadState>({ loaded: false, failed: false, reason: null });

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  const fetchIngredients = useCallback(() => {
    if (!ready || !id) return;
    void refresh(id)
      .catch(() => "error" as const)
      .then((result) => setLoad((prev) => nextLoadState(prev, result)));
  }, [ready, refresh, id]);

  // Show the cached list at once and fetch the server's version each time the screen comes back.
  useFocusEffect(fetchIngredients);

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

  const all: Ingredient[] = ready ? ingredientsFor(project.id) : [];
  const sorted = sortIngredients(all);
  const pending = pendingFor(project.id);
  const listState = taskListState({
    ready,
    cachedCount: all.length,
    loaded: load.loaded || (ready && loadedFor(project.id)),
    failed: load.failed,
  });
  const total = moneyOf(totalSpent(all.map((i) => i.purchase)), project.currency);

  const openIngredient = (item: Ingredient) =>
    once(() => router.push({ pathname: "/projects/[id]/ingredients/[ingredientId]", params: { id: project.id, ingredientId: item.id } }));
  const addIngredient = () => once(() => router.push({ pathname: "/projects/[id]/ingredients/new", params: { id: project.id } }));

  return (
    <Screen edges={[]}>
      {/* "＋ Thêm" sits at the top right, next to the title, as a text link (approved mockup). */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <PressableScale
              accessibilityRole="link"
              accessibilityLabel={t("ingredients.newIngredient")}
              onPress={addIngredient}
              style={{ minHeight: layout.controlHeight, justifyContent: "center", paddingHorizontal: spacing[1] }}
            >
              <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("ingredients.addLink")}</Text>
            </PressableScale>
          ),
        }}
      />
      <OfflineNote />
      <IngredientRejectedNotice />
      <Enter index={2}>
        {listState === "error" ? (
          <View
            accessibilityRole="alert"
            style={{ gap: spacing[0], padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.dangerBg }}
          >
            {/* Only a real network failure says offline; a server error says to try again. */}
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>
              {t(load.reason === "offline" ? "ingredients.loadError" : "ingredients.loadErrorServer")}
            </Text>
            {load.reason === "offline" ? <Text style={[typography.label, { color: colors.danger }]}>{t("home.offline")}</Text> : null}
            <Button label={t("ingredients.loadRetry")} variant="secondary" onPress={fetchIngredients} />
          </View>
        ) : listState === "loading" ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: spacing[1] }}>
            <View style={{ height: layout.controlHeight * 2, borderRadius: radius.card, backgroundColor: colors.field }} />
            {[0, 1, 2].map((n) => (
              <View key={n} style={{ height: layout.controlHeight + spacing[1], borderRadius: radius.card, backgroundColor: colors.field }} />
            ))}
          </View>
        ) : sorted.length === 0 ? (
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
              <Ionicons name="cube-outline" size={iconSize.xl} color={colors.accent} />
            </View>
            <View style={{ gap: spacing[0], alignItems: "center" }}>
              <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text, textAlign: "center" }]}>
                {t("ingredients.emptyTitle")}
              </Text>
              <Text style={[typography.body, { color: colors.textSecondary, textAlign: "center" }]}>{t("ingredients.emptyBody")}</Text>
            </View>
            <Button label={t("ingredients.emptyAdd")} variant="secondary" onPress={addIngredient} />
          </View>
        ) : (
          <View style={{ gap: spacing[2] }}>
            {/* The one hero of the screen: the total spent (DESIGN.md hero card). */}
            <View
              accessible
              accessibilityLabel={t("ingredients.totalA11y", { total, count: sorted.length })}
              style={{ gap: spacing[0], padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.accentStrong }}
            >
              <Text style={[typography.label, { color: onFixed }]}>{t("ingredients.totalLabel")}</Text>
              <Text style={[typography.screenTitle, { color: onFixed }]}>{total}</Text>
              <Text style={[typography.caption, { color: onFixed }]}>{t("ingredients.totalSub", { count: sorted.length })}</Text>
            </View>
            <Card flush>
              <View style={{ paddingHorizontal: spacing[2] }}>
                {sorted.map((item, index) => (
                  <IngredientRow
                    key={item.id}
                    item={item}
                    currency={project.currency}
                    pending={pending.has(item.id)}
                    divider={index > 0}
                    onOpen={() => openIngredient(item)}
                  />
                ))}
              </View>
            </Card>
          </View>
        )}
      </Enter>
    </Screen>
  );
}
