import { useHeaderHeight } from "expo-router/react-navigation";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useIngredients } from "../../../../../../ingredients/IngredientsProvider";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useGoToProjectList } from "../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../projects/routing";
import { Hint } from "../../../../../../products/ProductBits";
import { useProducts } from "../../../../../../products/ProductsProvider";
import { SizePills } from "../../../../../../products/SizePills";
import type { SizeName } from "../../../../../../products/types";
import { defaultNames, PRODUCT_NAME_MAX, toggleSize, validateName } from "../../../../../../products/view";
import { useTheme } from "../../../../../../theme/useTheme";
import { Button } from "../../../../../../ui/Button";
import { ErrorText } from "../../../../../../ui/ErrorText";
import { Screen } from "../../../../../../ui/Screen";
import { TextField } from "../../../../../../ui/TextField";

export default function NewProductScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const headerHeight = useHeaderHeight();
  const { colors, typography, radius, spacing } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const { create, productsFor, extraCostsFor } = useProducts();
  const { ingredientsFor } = useIngredients();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const [name, setName] = useState("");
  const [sizes, setSizes] = useState<SizeName[]>(["M"]);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  if (!project) return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;

  const problem = validateName(name, productsFor(project.id).map((p) => p.name), PRODUCT_NAME_MAX);
  const defaults = defaultNames(ingredientsFor(project.id), extraCostsFor(project.id));

  async function submit() {
    if (inFlight.current || !project) return;
    setSubmitted(true);
    setFormError(null);
    if (problem) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await create(project.id, name.trim(), sizes);
      if (result.ok) {
        // The product screen takes this form's place, so back returns to the list.
        router.replace({ pathname: "/projects/[id]/products/[productId]", params: { id: project.id, productId: result.id } });
      } else {
        setFormError(t("errors.generic"));
      }
    } catch {
      setFormError(t("errors.generic"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen edges={[]} keyboardOffset={headerHeight} footer={<Button label={t("products.create")} loading={busy} onPress={submit} />}>
      <View style={{ gap: spacing[2] }}>
        <TextField
          label={t("products.nameLabel")}
          icon="cafe-outline"
          placeholder={t("products.namePlaceholder")}
          autoFocus
          value={name}
          onChangeText={setName}
          error={submitted && problem ? t(`products.errors.${problem}`) : null}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <View style={{ gap: spacing[0] }}>
          <Text style={[typography.label, { color: colors.text }]}>{t("products.sizesLabel")}</Text>
          <SizePills value={sizes} onToggle={(size) => setSizes((c) => toggleSize(c, size))} />
          <Hint>{t("products.sizesHint")}</Hint>
        </View>
        <View style={{ padding: spacing[2], borderRadius: radius.card, borderWidth: 1, borderColor: colors.tileBorder, backgroundColor: colors.tile }}>
          <Text style={[typography.body, { color: colors.text }]}>
            {defaults.length > 0 ? t("products.defaultsNote", { names: defaults.join(", ") }) : t("products.defaultsNoteNone")}
          </Text>
        </View>
        {formError ? <ErrorText message={formError} /> : null}
      </View>
    </Screen>
  );
}
