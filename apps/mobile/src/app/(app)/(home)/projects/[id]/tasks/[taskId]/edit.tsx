import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { editFromForm, formFromTask } from "../../../../../../../tasks/formState";
import { TaskForm } from "../../../../../../../tasks/TaskForm";
import { useTasks } from "../../../../../../../tasks/TasksProvider";
import { useTaskScreen } from "../../../../../../../tasks/useTaskScreen";
import { useTheme } from "../../../../../../../theme/useTheme";
import { Button } from "../../../../../../../ui/Button";
import { Screen } from "../../../../../../../ui/Screen";

export default function EditTaskScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, layout } = useTheme();
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  const { update } = useTasks();
  const { project, task, view, deleting, canDelete, confirmDelete } = useTaskScreen(id, taskId);

  // While deleting, the task vanishes from the list; don't redirect before we navigate.
  if (deleting) return null;
  if (!project || !task) {
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

  return (
    <TaskForm
      projectId={project.id}
      initial={formFromTask(task)}
      submitLabel={t("tasks.saveButton")}
      onSubmit={async (form, opened) => {
        // Only what the person changed since the form opened; the rest may have been refreshed meanwhile.
        const result = await update(project.id, task.id, editFromForm(opened, form));
        if (result.ok) router.back();
        return result;
      }}
      extra={canDelete ? <Button label={t("tasks.deleteButton")} variant="danger" onPress={confirmDelete} /> : null}
    />
  );
}
