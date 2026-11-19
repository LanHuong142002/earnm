import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

import { emptyIngredientForm } from "../../../../../../ingredients/display";
import { IngredientForm } from "../../../../../../ingredients/IngredientForm";
import { useIngredients } from "../../../../../../ingredients/IngredientsProvider";
import { useGoToProjectList } from "../../../../../../projects/useProjectNav";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { projectView } from "../../../../../../projects/routing";
import { Screen } from "../../../../../../ui/Screen";

export default function NewIngredientScreen() {
  const router = useRouter();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const { create, ingredientsFor } = useIngredients();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  if (!project) {
    return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;
  }

  return (
    <IngredientForm
      initial={emptyIngredientForm()}
      currency={project.currency}
      existingNames={ingredientsFor(project.id).map((i) => i.name)}
      onSubmit={async (form, purchase) => {
        const result = await create(project.id, { name: form.name, mode: form.mode, purchase, isDefault: form.isDefault });
        // Back to the list the form was opened from; the filled-in form isn't left in the history.
        if (result.ok) router.back();
        return result.ok;
      }}
    />
  );
}
