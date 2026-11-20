import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { moneyOf } from "../../../../../../ingredients/display";
import { afterDelete } from "../../../../../../products/fixedCostForm";
import { FixedCostForm } from "../../../../../../products/FixedCostScreenForm";
import { useProducts } from "../../../../../../products/ProductsProvider";
import type { FixedCost } from "../../../../../../products/types";
import { useGoToProjectList } from "../../../../../../projects/useProjectNav";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { projectView } from "../../../../../../projects/routing";
import { useTheme } from "../../../../../../theme/useTheme";
import { Screen } from "../../../../../../ui/Screen";

export default function EditFixedCostScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const { colors, typography } = useTheme();
  const { id, fixedCostId } = useLocalSearchParams<{ id: string; fixedCostId: string }>();
  const { status, projects } = useProjects();
  const { ready, fixedCostsFor, expectedCupsFor, editFixedCost, deleteFixedCost } = useProducts();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const all = project && ready ? fixedCostsFor(project.id) : [];
  const item = all.find((i) => i.id === fixedCostId) ?? null;
  // The form is filled once, from what the cost was when the screen opened; later syncs don't overwrite typing.
  const [opened, setOpened] = useState<FixedCost | null>(null);
  if (item && !opened) setOpened(item);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  if (!project) {
    return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;
  }
  if (!opened) {
    return (
      <Screen edges={[]}>
        {ready && item === null ? (
          <Text accessibilityRole="alert" style={[typography.body, { color: colors.textSecondary }]}>
            {t("fixedCosts.notFound")}
          </Text>
        ) : null}
      </Screen>
    );
  }

  const first = opened;
  const cups = expectedCupsFor(project.id);
  const confirmDelete = () => {
    // Mockup 1g: the dialog names what the total and the per-cup share become.
    const left = afterDelete(all, first.id, cups);
    const message =
      all.length <= 1
        ? t("fixedCosts.deleteMessageNone")
        : left.share === null
          ? t("fixedCosts.deleteMessageNoShare", { total: moneyOf(left.total, project.currency) })
          : t("fixedCosts.deleteMessage", { total: moneyOf(left.total, project.currency), share: moneyOf(left.share, project.currency) });
    Alert.alert(t("fixedCosts.deleteTitle", { name: first.name }), message, [
      { text: t("fixedCosts.cancel"), style: "cancel" },
      {
        text: t("fixedCosts.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          void deleteFixedCost(project.id, first.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: first.name }} />
      <FixedCostForm
        initial={{ name: first.name, kind: first.kind, amount: first.amount, months: first.months }}
        currency={project.currency}
        items={all}
        editingId={first.id}
        cups={cups}
        onDelete={confirmDelete}
        onSubmit={async (values) => {
          const result = await editFixedCost(project.id, first.id, {
            name: values.name,
            kind: values.kind,
            amount: values.amount,
            ...(values.kind === "oneTime" ? { months: values.months } : {}),
          });
          if (result.ok) router.back();
          return result.ok;
        }}
      />
    </>
  );
}
