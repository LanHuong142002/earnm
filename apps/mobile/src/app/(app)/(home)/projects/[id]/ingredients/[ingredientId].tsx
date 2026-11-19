import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formFromIngredient } from "../../../../../../ingredients/display";
import { IngredientForm } from "../../../../../../ingredients/IngredientForm";
import { useIngredients } from "../../../../../../ingredients/IngredientsProvider";
import type { Ingredient } from "../../../../../../ingredients/types";
import { PriceHistory } from "../../../../../../ingredients/PriceHistory";
import { useGoToProjectList } from "../../../../../../projects/useProjectNav";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useProducts } from "../../../../../../products/ProductsProvider";
import { joinNames, productsUsing } from "../../../../../../products/view";
import { projectView } from "../../../../../../projects/routing";
import { useTheme } from "../../../../../../theme/useTheme";
import { Button } from "../../../../../../ui/Button";
import { Collapsible } from "../../../../../../ui/Collapsible";
import { Screen } from "../../../../../../ui/Screen";

export default function EditIngredientScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const { colors, typography, spacing } = useTheme();
  const { id, ingredientId } = useLocalSearchParams<{ id: string; ingredientId: string }>();
  const { status, projects } = useProjects();
  const { ready, ingredientsFor, update, remove } = useIngredients();
  const { ready: productsReady, productsFor, refresh: refreshProducts } = useProducts();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const all = project && ready ? ingredientsFor(project.id) : [];
  const item = all.find((i) => i.id === ingredientId) ?? null;
  // The form is filled once, from what the ingredient was when the screen opened; later refreshes don't overwrite typing.
  const [opened, setOpened] = useState<Ingredient | null>(null);
  if (item && !opened) setOpened(item);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  // Which products use this ingredient is read from their recipes, so they are fetched when the screen opens.
  useEffect(() => {
    if (productsReady && id) void refreshProducts(id).catch(() => undefined);
  }, [productsReady, refreshProducts, id]);

  if (!project) {
    return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;
  }
  if (!opened) {
    return (
      <Screen edges={[]}>
        {ready && item === null ? (
          <Text accessibilityRole="alert" style={[typography.body, { color: colors.textSecondary }]}>
            {t("ingredients.notFound")}
          </Text>
        ) : null}
      </Screen>
    );
  }

  const first = opened;
  const usedBy = productsReady ? productsUsing(first.id, productsFor(project.id)) : [];
  const confirmDelete = () =>
    usedBy.length > 0
      ? // Mockup 1g: an ingredient in a recipe can't be deleted; the products that use it are named.
        Alert.alert(
          t("ingredients.inUseTitle", { name: item?.name ?? first.name }),
          t("ingredients.inUseMessage", { name: item?.name ?? first.name, products: joinNames(usedBy, t("products.and")) }),
          [{ text: t("ingredients.inUseOk") }],
        )
      : Alert.alert(t("ingredients.deleteTitle", { name: item?.name ?? first.name }), t("ingredients.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("ingredients.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          void remove(project.id, first.id);
          router.back();
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: first.name }} />
      <IngredientForm
        initial={formFromIngredient(first, project.currency)}
        currency={project.currency}
        existingNames={all.filter((i) => i.id !== first.id).map((i) => i.name)}
        onSubmit={async (form, purchase) => {
          const result = await update(project.id, first.id, {
            name: form.name,
            mode: form.mode,
            purchase,
            isDefault: form.isDefault,
          });
          if (result.ok) router.back();
          return result.ok;
        }}
        extra={
          <View style={{ gap: spacing[2] }}>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {usedBy.length > 0 ? t("ingredients.editHintUsed", { count: usedBy.length }) : t("ingredients.editHint")}
            </Text>
            <PriceHistory entries={item?.prices ?? first.prices} currency={project.currency} />
            {usedBy.length > 0 ? (
              <Collapsible title={t("ingredients.usedIn", { count: usedBy.length })}>
                <View style={{ gap: spacing[0] }}>
                  {usedBy.map((name) => (
                    <Text key={name} style={[typography.body, { color: colors.text }]}>
                      {name}
                    </Text>
                  ))}
                </View>
              </Collapsible>
            ) : null}
            <Button label={t("ingredients.deleteButton")} variant="danger" onPress={confirmDelete} />
          </View>
        }
      />
    </>
  );
}
