import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { useTranslation } from "react-i18next";

import { changedFields } from "../../../../../projects/optimistic";
import { ProjectForm } from "../../../../../projects/ProjectForm";
import { useGoToProjectList } from "../../../../../projects/useProjectNav";
import { projectView } from "../../../../../projects/routing";
import { useProjects } from "../../../../../projects/ProjectsProvider";
import { useTheme } from "../../../../../theme/useTheme";
import { Button } from "../../../../../ui/Button";
import { Screen } from "../../../../../ui/Screen";

export default function EditProjectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const { colors, typography, radius } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects, currentProjectId, update, remove, setCurrentProject } = useProjects();
  const [deleting, setDeleting] = useState(false);
  const focused = useIsFocused();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, true);

  // Gone, or not an Owner: leave for the list. Not while deleting, which navigates itself.
  useEffect(() => {
    if (view === "leave" && focused && !deleting) goToList();
  }, [view, focused, deleting, goToList]);

  // While deleting, the project vanishes from the list; don't redirect before we navigate.
  if (deleting) return null;

  if (!project) {
    return (
      <Screen edges={[]}>
        {view === "loading" ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              height: typography.screenTitle.lineHeight,
              width: "60%",
              borderRadius: radius.field,
              backgroundColor: colors.field,
            }}
          />
        ) : null}
      </Screen>
    );
  }
  if (view === "leave") return null;

  function confirmDelete() {
    if (!project) return;
    Alert.alert(
      t("projects.deleteTitle", { name: project.name }),
      t("projects.deleteMessage", { name: project.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("projects.deleteConfirm"),
          style: "destructive",
          onPress: () => {
            setDeleting(true);
            void (async () => {
              try {
                if (currentProjectId === project.id) await setCurrentProject(null);
                await remove(project.id);
                // Back to the list; nothing of the deleted project stays in the history.
                goToList();
              } catch {
                setDeleting(false);
                Alert.alert(t("errors.generic"));
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <ProjectForm
      initial={{
        name: project.name,
        description: project.description,
        currency: project.currency,
      }}
      submitLabel={t("projects.saveButton")}
      onSubmit={async (fields, opened) => {
        // Only what the person changed since the form opened; the rest may have been refreshed meanwhile.
        const result = await update(project.id, changedFields(opened, fields));
        if (result.ok) router.back();
        return result;
      }}
      extra={<Button label={t("projects.deleteButton")} variant="danger" onPress={confirmDelete} />}
    />
  );
}
