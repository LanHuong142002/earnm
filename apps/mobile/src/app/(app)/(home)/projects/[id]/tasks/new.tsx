import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { useGoToProjectList } from "../../../../../../projects/useProjectNav";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { projectView } from "../../../../../../projects/routing";
import { emptyForm, inputFromForm } from "../../../../../../tasks/formState";
import { TaskForm } from "../../../../../../tasks/TaskForm";
import { useTasks } from "../../../../../../tasks/TasksProvider";
import { Screen } from "../../../../../../ui/Screen";

export default function NewTaskScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const { create } = useTasks();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  if (!project) {
    return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;
  }

  return (
    <TaskForm
      projectId={project.id}
      initial={emptyForm()}
      showStatus={false}
      submitLabel={t("tasks.saveButton")}
      onSubmit={async (form) => {
        const result = await create(project.id, inputFromForm(form));
        // Back to the list the form was opened from; the filled-in form isn't left in the history.
        if (result.ok) router.back();
        return result;
      }}
    />
  );
}
