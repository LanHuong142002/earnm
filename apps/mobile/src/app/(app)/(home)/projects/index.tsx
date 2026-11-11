import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ProjectCard } from "../../../../projects/ProjectCard";
import { OfflineNote } from "../../../../projects/OfflineNote";
import { RejectedNoticeBanner } from "../../../../projects/RejectedNotice";
import { useTapOnce } from "../../../../projects/useProjectNav";
import { useProjects } from "../../../../projects/ProjectsProvider";
import { showInvitation, showOfflineEmpty } from "../../../../projects/routing";
import { useTheme } from "../../../../theme/useTheme";
import { Button } from "../../../../ui/Button";
import { Enter } from "../../../../ui/Enter";
import { Screen } from "../../../../ui/Screen";

// Project cards that animate in one after another (DESIGN.md Motion).
const STAGGER_LIMIT = 8;

export default function ProjectsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const once = useTapOnce();
  const { colors, typography, layout, radius, spacing } = useTheme();
  const { status, projects, setCurrentProject, refresh } = useProjects();

  // R17: fetch the server's list every time this screen is shown.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // Push first so a quick double tap pushes once; the choice is saved in the background.
  function open(id: string) {
    once(() => {
      router.push({ pathname: "/projects/[id]", params: { id } });
      void setCurrentProject(id).catch(() => {});
    });
  }

  const empty = showInvitation(status, projects.length);
  const offlineEmpty = showOfflineEmpty(status, projects.length);

  return (
    <Screen edges={[]}>
      <RejectedNoticeBanner />
      <OfflineNote />
      {projects.length === 0 && status === "loading" ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            height: layout.controlHeight * 2,
            borderRadius: radius.card,
            backgroundColor: colors.field,
          }}
        />
      ) : null}
      {empty ? (
        <Enter index={0}>
          <View style={{ gap: spacing[0] }}>
            <Text
              accessibilityRole="header"
              style={[typography.sectionTitle, { color: colors.text }]}
            >
              {t("projects.emptyTitle")}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {t("projects.emptyBody")}
            </Text>
          </View>
        </Enter>
      ) : null}
      {offlineEmpty ? (
        <Enter index={0}>
          <View style={{ gap: spacing[0] }}>
            <Text
              accessibilityRole="header"
              style={[typography.sectionTitle, { color: colors.text }]}
            >
              {t("projects.offlineEmptyTitle")}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {t("projects.offlineEmptyBody")}
            </Text>
          </View>
        </Enter>
      ) : null}
      {projects.length > 0 ? (
        <View style={{ gap: spacing[2] }}>
          {projects.map((p, i) => {
            const card = <ProjectCard project={p} onPress={() => open(p.id)} />;
            // Only the first cards animate in, one after another.
            return i < STAGGER_LIMIT ? (
              <Enter key={p.id} index={i}>
                {card}
              </Enter>
            ) : (
              <View key={p.id}>{card}</View>
            );
          })}
        </View>
      ) : null}
      <Enter index={Math.min(projects.length, STAGGER_LIMIT)}>
        <Button
          label={t("projects.newButton")}
          variant={empty ? "primary" : "soft"}
          onPress={() => once(() => router.push("/projects/new"))}
        />
      </Enter>
    </Screen>
  );
}
