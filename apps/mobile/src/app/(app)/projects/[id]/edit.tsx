import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ProjectForm } from "../../../../projects/ProjectForm";
import { useProjects } from "../../../../projects/ProjectsProvider";
import { useTheme } from "../../../../theme/useTheme";
import { Button } from "../../../../ui/Button";
import { Screen } from "../../../../ui/Screen";

export default function EditProjectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, typography, radius } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects, currentProjectId, update, remove, setCurrentProject } = useProjects();
  const [deleting, setDeleting] = useState(false);
  const project = projects.find((p) => p.id === id) ?? null;

  // While deleting, the project vanishes from the list; don't redirect before we navigate.
  if (deleting) return null;

  if (!project) {
    if (status === "loading") {
      return (
        <Screen edges={["bottom"]}>
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
        </Screen>
      );
    }
    return <Redirect href="/" />;
  }
  if (project.role !== "owner") return <Redirect href="/" />;

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
                router.replace("/projects");
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
      onSubmit={async (fields) => {
        const result = await update(project.id, fields);
        if (result.ok) router.back();
        return result;
      }}
      extra={<Button label={t("projects.deleteButton")} variant="danger" onPress={confirmDelete} />}
    />
  );
}
