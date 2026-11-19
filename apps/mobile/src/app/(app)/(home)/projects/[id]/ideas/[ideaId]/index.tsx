import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../../../../../../auth/AuthProvider";
import { ideaParent } from "../../../../../../../ideas/adapters";
import { IdeaRejectedNotice } from "../../../../../../../ideas/IdeaRejectedNotice";
import { useIdeas } from "../../../../../../../ideas/IdeasProvider";
import { createTaskState, ideaAuthorName } from "../../../../../../../ideas/view";
import { ideaDayOf, isOnline } from "../../../../../../../ideas/screenView";
import { StatusPill } from "../../../../../../../ideas/StatusPill";
import { useIdeaScreen } from "../../../../../../../ideas/useIdeaScreen";
import { BigVote } from "../../../../../../../ideas/VoteControls";
import { OfflineNote } from "../../../../../../../projects/OfflineNote";
import { useProjects } from "../../../../../../../projects/ProjectsProvider";
import { useTapOnce } from "../../../../../../../projects/useProjectNav";
import { CommentsSection } from "../../../../../../../tasks/comments/CommentsSection";
import { formatDue, type DueLanguage } from "../../../../../../../tasks/dueDate";
import { LabelChip } from "../../../../../../../tasks/LabelChip";
import { resolveLabels } from "../../../../../../../tasks/labelDisplay";
import { PhotosSection } from "../../../../../../../tasks/photos/PhotosSection";
import { useTasks } from "../../../../../../../tasks/TasksProvider";
import { useTheme } from "../../../../../../../theme/useTheme";
import { Button } from "../../../../../../../ui/Button";
import { Card } from "../../../../../../../ui/Card";
import { Enter } from "../../../../../../../ui/Enter";
import { PressableScale } from "../../../../../../../ui/PressableScale";
import { Screen } from "../../../../../../../ui/Screen";

export default function IdeaDetailsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const once = useTapOnce();
  const { colors, typography, radius, spacing, layout, iconSize, header } = useTheme();
  const { id, ideaId } = useLocalSearchParams<{ id: string; ideaId: string }>();
  const { identity, profileStatus } = useAuth();
  const { status: projectsStatus } = useProjects();
  const { labelsFor } = useTasks();
  const { refresh, pendingFor, vote } = useIdeas();
  const { project, idea, view, deleting, canEdit } = useIdeaScreen(id, ideaId);
  const headerHeight = useHeaderHeight();

  // Fetch the server's version each time the screen is in front (the score and the linked task may have changed).
  useFocusEffect(
    useCallback(() => {
      void refresh(id).catch(() => undefined);
    }, [refresh, id]),
  );

  // While deleting, the idea vanishes from the list; don't redirect before we navigate.
  if (deleting) return null;
  if (!project || !idea) {
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

  const lang: DueLanguage = i18n.language === "vi" ? "vi" : "en";
  const day = ideaDayOf(idea.createdAt);
  const dateText = day === null ? "" : formatDue(day, null, lang, t);
  const author = ideaAuthorName(idea, t("ideas.formerMember"));
  const labels = resolveLabels(idea.labelIds, labelsFor(project.id));
  const statusName = t(`ideas.status.${idea.status}`);
  const pending = pendingFor(project.id).has(idea.id);
  const parent = ideaParent(project.id, idea.id, idea, identity?.id ?? null, project.role);
  const button = createTaskState(idea, isOnline(projectsStatus, profileStatus));

  const caption = (text: string) => <Text style={[typography.label, { color: colors.textSecondary }]}>{text}</Text>;

  return (
    <Screen edges={[]} keyboardOffset={headerHeight}>
      {canEdit ? (
        <Stack.Screen
          options={{
            headerRight: () => (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t("ideas.editA11y")}
                onPress={() =>
                  once(() => router.push({ pathname: "/projects/[id]/ideas/[ideaId]/edit", params: { id: project.id, ideaId: idea.id } }))
                }
                style={{ minWidth: layout.controlHeight, height: layout.controlHeight, alignItems: "flex-end", justifyContent: "center", marginRight: header.backInset }}
              >
                <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("ideas.editButton")}</Text>
              </PressableScale>
            ),
          }}
        />
      ) : null}
      <OfflineNote />
      <IdeaRejectedNotice />
      <Enter index={0}>
        <View style={{ gap: spacing[2] }}>
          <Text accessibilityRole="header" style={[typography.screenTitle, { color: colors.text }]}>
            {idea.title}
          </Text>
          <Card>
            <View style={{ gap: spacing[2] }}>
              <View style={{ gap: spacing[0] }}>
                {caption(t("ideas.statusLabel"))}
                {/* The status is changed by any member, as on a task: a tap opens the sheet. */}
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={t("ideas.statusPillLabel", { status: statusName })}
                  onPress={() => once(() => router.push({ pathname: "/projects/[id]/ideas/[ideaId]/status", params: { id: project.id, ideaId: idea.id } }))}
                  style={{ minHeight: layout.controlHeight, flexDirection: "row", alignItems: "center", gap: spacing[0] }}
                >
                  {/* "Đã chọn" keeps its check (spec R21); the others are plain text. */}
                  {idea.status === "accepted" ? (
                    <StatusPill status={idea.status} />
                  ) : (
                    <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{statusName}</Text>
                  )}
                  <Ionicons name="chevron-down" size={iconSize.sm} color={colors.accentStrong} />
                </PressableScale>
              </View>
              <View style={{ gap: spacing[0] }}>
                {caption(t("ideas.labelsLabel"))}
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[0] + 2 }}>
                  {labels.length === 0 ? (
                    <Text style={[typography.body, { color: colors.textSecondary }]}>{t("ideas.labelsNone")}</Text>
                  ) : (
                    labels.map((label) => <LabelChip key={label.id} label={label} size="md" />)
                  )}
                  {canEdit ? (
                    <PressableScale
                      accessibilityRole="link"
                      accessibilityLabel={t("ideas.addLabelsA11y")}
                      onPress={() => once(() => router.push({ pathname: "/projects/[id]/ideas/[ideaId]/edit", params: { id: project.id, ideaId: idea.id } }))}
                      style={{ minHeight: layout.controlHeight, justifyContent: "center" }}
                    >
                      <Text style={[typography.label, { color: colors.accentStrong }]}>{t("ideas.addLabels")}</Text>
                    </PressableScale>
                  ) : null}
                </View>
              </View>
              <View style={{ gap: spacing[0] }}>
                {caption(t("ideas.descriptionLabel"))}
                <Text style={[typography.body, { color: idea.description === "" ? colors.textSecondary : colors.text }]}>
                  {idea.description === "" ? t("ideas.descriptionNone") : idea.description}
                </Text>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[1] }}>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  {dateText === "" ? author : t("ideas.authorLine", { name: author, date: dateText })}
                </Text>
                {pending ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("ideas.pending")}</Text> : null}
              </View>
            </View>
          </Card>
        </View>
      </Enter>
      <Enter index={1}>
        <View style={{ gap: spacing[2] }}>
          {button === "created" && idea.task ? (
            <Card flush>
              <PressableScale
                accessibilityRole="link"
                accessibilityLabel={t("ideas.createdTaskA11y", { title: idea.task.title, status: t(`tasks.status.${idea.task.status}`) })}
                onPress={() =>
                  once(() => router.push({ pathname: "/projects/[id]/tasks/[taskId]", params: { id: project.id, taskId: idea.task!.id } }))
                }
                style={{ minHeight: layout.controlHeight + spacing[1], flexDirection: "row", alignItems: "center", gap: spacing[1] + spacing[0], paddingHorizontal: spacing[2], paddingVertical: spacing[1] }}
              >
                <View
                  style={{
                    width: layout.controlHeight - spacing[1],
                    height: layout.controlHeight - spacing[1],
                    borderRadius: radius.button,
                    backgroundColor: colors.tile,
                    borderWidth: 1,
                    borderColor: colors.tileBorder,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="checkbox-outline" size={iconSize.lg} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  {caption(t("ideas.createdTask"))}
                  <Text style={[typography.bodyStrong, { color: colors.text }]}>{idea.task.title}</Text>
                </View>
                <Text style={[typography.caption, { color: colors.accentStrong }]}>{t(`tasks.status.${idea.task.status}`)}</Text>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} />
              </PressableScale>
            </Card>
          ) : button === "available" || button === "needs_network" ? (
            <View style={{ gap: spacing[0] }}>
              <Button
                label={t("ideas.createTaskButton")}
                variant="secondary"
                disabled={button === "needs_network"}
                onPress={() =>
                  once(() => router.push({ pathname: "/projects/[id]/tasks/new", params: { id: project.id, fromIdea: idea.id } }))
                }
              />
              {/* A disabled button always says why (DESIGN.md). */}
              {button === "needs_network" ? (
                <Text style={[typography.label, { color: colors.textSecondary }]}>{t("ideas.needsNetwork")}</Text>
              ) : null}
            </View>
          ) : null}
          <BigVote score={idea.score} myVote={idea.myVote} onVote={(pressed) => void vote(project.id, idea.id, pressed)} />
        </View>
      </Enter>
      <Enter index={2}>
        <PhotosSection
          parent={parent}
          onOpenPhoto={(photoId) =>
            router.push({ pathname: "/projects/[id]/ideas/[ideaId]/photos", params: { id: project.id, ideaId: idea.id, photoId } })
          }
        />
      </Enter>
      <Enter index={3}>
        <CommentsSection parent={parent} />
      </Enter>
    </Screen>
  );
}
