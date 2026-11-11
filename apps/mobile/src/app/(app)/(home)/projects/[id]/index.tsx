import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { OfflineNote } from "../../../../../projects/OfflineNote";
import { RejectedNoticeBanner } from "../../../../../projects/RejectedNotice";
import { useProjects } from "../../../../../projects/ProjectsProvider";
import { useGoToProjectList, useTapOnce } from "../../../../../projects/useProjectNav";
import { projectView } from "../../../../../projects/routing";
import { useTheme } from "../../../../../theme/useTheme";
import { Button } from "../../../../../ui/Button";
import { Collapsible } from "../../../../../ui/Collapsible";
import { Enter } from "../../../../../ui/Enter";
import { Screen } from "../../../../../ui/Screen";

export default function ProjectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const once = useTapOnce();
  const focused = useIsFocused();
  const { colors, typography, radius, spacing } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);

  // Unknown or vanished project: back to the list (which shows the notice). Only while this
  // screen is the one in front, so a delete started on Edit isn't raced from underneath.
  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

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

  return (
    <Screen edges={[]}>
      <OfflineNote />
      <RejectedNoticeBanner />
      <Enter index={1}>
        <View style={{ gap: spacing[0] }}>
          <Text accessibilityRole="header" style={[typography.screenTitle, { color: colors.text }]}>
            {project.name}
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            {t("projects.currencyLine", { currency: project.currency })}
          </Text>
        </View>
      </Enter>
      <Enter index={2}>
        <Collapsible title={t("projects.details")}>
          <Text style={[typography.body, { color: colors.text }]}>
            {project.description !== "" ? project.description : t("projects.noDescription")}
          </Text>
        </Collapsible>
      </Enter>
      <Enter index={3}>
        <View style={{ gap: spacing[1] }}>
          {project.role === "owner" ? (
            <Button
              label={t("projects.edit")}
              variant="secondary"
              onPress={() => once(() => router.push({ pathname: "/projects/[id]/edit", params: { id: project.id } }))}
            />
          ) : null}
        </View>
      </Enter>
    </Screen>
  );
}
