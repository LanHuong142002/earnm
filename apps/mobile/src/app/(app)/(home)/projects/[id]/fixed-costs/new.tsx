import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

import { FixedCostForm } from "../../../../../../products/FixedCostScreenForm";
import { useProducts } from "../../../../../../products/ProductsProvider";
import { useGoToProjectList } from "../../../../../../projects/useProjectNav";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { projectView } from "../../../../../../projects/routing";
import { Screen } from "../../../../../../ui/Screen";

export default function NewFixedCostScreen() {
  const router = useRouter();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const { addFixedCost, fixedCostsFor, expectedCupsFor } = useProducts();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  if (!project) {
    return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;
  }

  return (
    <FixedCostForm
      initial={null}
      currency={project.currency}
      items={fixedCostsFor(project.id)}
      editingId={null}
      cups={expectedCupsFor(project.id)}
      onSubmit={async (values) => {
        const result = await addFixedCost(project.id, values);
        if (result.ok) router.back();
        return result.ok;
      }}
    />
  );
}
