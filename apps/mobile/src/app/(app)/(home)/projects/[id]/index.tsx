import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ProjectCover, roleKey } from "../../../../../projects/ProjectCard";
import { OfflineNote } from "../../../../../projects/OfflineNote";
import { RejectedNoticeBanner } from "../../../../../projects/RejectedNotice";
import { useProjects } from "../../../../../projects/ProjectsProvider";
import { useGoToProjectList, useTapOnce } from "../../../../../projects/useProjectNav";
import { projectView } from "../../../../../projects/routing";
import { countNotDone } from "../../../../../tasks/counts";
import { useTasks } from "../../../../../tasks/TasksProvider";
import { useTheme } from "../../../../../theme/useTheme";
import { AreaTile } from "../../../../../ui/AreaTile";
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
  const { ready, refresh, tasksFor } = useTasks();
  // The Tasks tile shows no count until this project's tasks have been loaded at least once.
  const [loaded, setLoaded] = useState(false);

  // Fetch this project's tasks each time the screen is in front, so the count is fresh (R14).
  useFocusEffect(
    useCallback(() => {
      if (!ready || !id) return;
      void refresh(id)
        .then((result) => {
          if (result === "ok") setLoaded(true);
        })
        .catch(() => undefined);
    }, [ready, refresh, id]),
  );

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

  const tasks = tasksFor(project.id);

  return (
    <Screen edges={[]}>
      <OfflineNote />
      <RejectedNoticeBanner />
      <Enter index={1}>
        <View style={{ gap: spacing[2] }}>
          <View style={{ borderRadius: radius.card, overflow: "hidden" }}>
            <ProjectCover
              currency={project.currency}
              pillLabel={t("projects.currencyLine", { currency: project.currency })}
            />
          </View>
          <View style={{ gap: spacing[0] }}>
            <Text accessibilityRole="header" style={[typography.screenTitle, { color: colors.text }]}>
              {project.name}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>{t(roleKey(project.role))}</Text>
          </View>
        </View>
      </Enter>
      <Enter index={2}>
        <View style={{ gap: spacing[2] }}>
          <View style={{ flexDirection: "row", gap: spacing[2] }}>
            <AreaTile
              shape="wide"
              icon="checkbox-outline"
              label={t("tasks.title")}
              caption={
                tasks.length > 0 || loaded ? t("tasks.notDone", { count: countNotDone(tasks) }) : undefined
              }
              onPress={() => once(() => router.push({ pathname: "/projects/[id]/tasks", params: { id: project.id } }))}
            />
            <AreaTile shape="wide" icon="bulb-outline" label={t("home.areaIdeas")} comingSoon={t("home.comingSoon")} />
          </View>
          <View style={{ flexDirection: "row", gap: spacing[2] }}>
            <AreaTile shape="wide" icon="cube-outline" label={t("projects.areaProducts")} comingSoon={t("home.comingSoon")} />
            <AreaTile
              shape="wide"
              icon="receipt-outline"
              label={t("projects.areaFixedCosts")}
              comingSoon={t("home.comingSoon")}
            />
          </View>
        </View>
      </Enter>
      <Enter index={3}>
        <Collapsible title={t("projects.details")}>
          <Text style={[typography.body, { color: colors.text }]}>
            {project.description !== "" ? project.description : t("projects.noDescription")}
          </Text>
        </Collapsible>
      </Enter>
      <Enter index={4}>
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
