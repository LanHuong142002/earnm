import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DEFAULT_IDEA_FILTERS, filterIdeas, type IdeaFilters } from "../../../../../../ideas/filters";
import { IdeaFilterBar } from "../../../../../../ideas/IdeaFilterBar";
import { IdeaRejectedNotice } from "../../../../../../ideas/IdeaRejectedNotice";
import { IdeaRow } from "../../../../../../ideas/IdeaRow";
import { useIdeas } from "../../../../../../ideas/IdeasProvider";
import { orderIdeas } from "../../../../../../ideas/order";
import type { Idea } from "../../../../../../ideas/types";
import { OfflineNote } from "../../../../../../projects/OfflineNote";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useGoToProjectList, useTapOnce } from "../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../projects/routing";
import { nextLoadState, taskListState, type LoadState } from "../../../../../../tasks/listState";
import { useTasks } from "../../../../../../tasks/TasksProvider";
import { useTheme } from "../../../../../../theme/useTheme";
import { Button } from "../../../../../../ui/Button";
import { Card } from "../../../../../../ui/Card";
import { Collapsible } from "../../../../../../ui/Collapsible";
import { Enter } from "../../../../../../ui/Enter";
import { PressableScale } from "../../../../../../ui/PressableScale";
import { Screen } from "../../../../../../ui/Screen";

export default function IdeaListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const once = useTapOnce();
  const focused = useIsFocused();
  const { colors, typography, radius, spacing, layout } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const { labelsFor } = useTasks();
  const { ready, refresh, ideasFor, pendingFor, vote } = useIdeas();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);

  const [filters, setFilters] = useState<IdeaFilters>(DEFAULT_IDEA_FILTERS);
  // "loaded" only after a refresh answered "ok"; "failed" after a network or server error.
  // The first load shows blocks, a failed first load shows an error, never "no ideas".
  const [load, setLoad] = useState<LoadState>({ loaded: false, failed: false, reason: null });

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  const fetchIdeas = useCallback(() => {
    if (!ready || !id) return;
    void refresh(id)
      .catch(() => "error" as const)
      .then((result) => setLoad((prev) => nextLoadState(prev, result)));
  }, [ready, refresh, id]);

  // Show the cached list at once and fetch the server's version each time the screen comes back.
  useFocusEffect(fetchIdeas);

  if (!project) {
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

  const all = ready ? ideasFor(project.id) : [];
  const labels = labelsFor(project.id);
  const pending = pendingFor(project.id);
  const { open, dropped } = orderIdeas(filterIdeas(all, filters, labels));
  const listState = taskListState({ ready, cachedCount: all.length, loaded: load.loaded, failed: load.failed });
  const filtered = filters.status !== "all" || filters.labelIds.length > 0;
  const none = open.length === 0 && dropped.length === 0;

  const openIdea = (idea: Idea) =>
    once(() => router.push({ pathname: "/projects/[id]/ideas/[ideaId]", params: { id: project.id, ideaId: idea.id } }));
  const addIdea = () => once(() => router.push({ pathname: "/projects/[id]/ideas/new", params: { id: project.id } }));
  const rows = (list: Idea[]) => (
    <Card flush>
      <View style={{ paddingHorizontal: spacing[2] }}>
        {list.map((idea, index) => (
          <IdeaRow
            key={idea.id}
            idea={idea}
            labels={labels}
            pending={pending.has(idea.id)}
            divider={index > 0}
            onOpen={() => openIdea(idea)}
            onVote={(pressed) => void vote(project.id, idea.id, pressed)}
          />
        ))}
      </View>
    </Card>
  );

  return (
    <Screen edges={[]}>
      {/* "＋ Mới" sits at the top right, next to the title, as a text link (approved mockup). */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <PressableScale
              accessibilityRole="link"
              accessibilityLabel={t("ideas.newIdea")}
              onPress={addIdea}
              style={{ minHeight: layout.controlHeight, justifyContent: "center", paddingHorizontal: spacing[1] }}
            >
              <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("ideas.addLink")}</Text>
            </PressableScale>
          ),
        }}
      />
      <OfflineNote />
      <IdeaRejectedNotice />
      {all.length > 0 || filtered ? (
        <Enter index={2}>
          <IdeaFilterBar filters={filters} labels={labels} onChange={setFilters} />
        </Enter>
      ) : null}
      <Enter index={3}>
        {listState === "error" ? (
          <View
            accessibilityRole="alert"
            style={{ gap: spacing[0], padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.dangerBg }}
          >
            {/* Only a real network failure says offline; a server error says to try again. */}
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>
              {t(load.reason === "offline" ? "ideas.loadError" : "ideas.loadErrorServer")}
            </Text>
            {load.reason === "offline" ? <Text style={[typography.label, { color: colors.danger }]}>{t("home.offline")}</Text> : null}
            <Button label={t("ideas.loadRetry")} variant="secondary" onPress={fetchIdeas} />
          </View>
        ) : listState === "loading" ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: spacing[2] }}>
            {[0, 1].map((n) => (
              <View key={n} style={{ height: layout.controlHeight * 2, borderRadius: radius.card, backgroundColor: colors.field }} />
            ))}
          </View>
        ) : none ? (
          <View style={{ gap: spacing[1] }}>
            <View style={{ gap: spacing[0] }}>
              <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text }]}>
                {t(filtered ? "ideas.noMatchTitle" : "ideas.emptyTitle")}
              </Text>
              <Text style={[typography.body, { color: colors.textSecondary }]}>
                {t(filtered ? "ideas.noMatchBody" : "ideas.emptyBody")}
              </Text>
            </View>
            {filtered ? (
              <Button label={t("ideas.clearFilters")} variant="secondary" onPress={() => setFilters(DEFAULT_IDEA_FILTERS)} />
            ) : (
              <Button label={t("ideas.emptyAdd")} variant="secondary" onPress={addIdea} />
            )}
          </View>
        ) : (
          <View style={{ gap: spacing[2] }}>
            {open.length > 0 ? rows(open) : null}
            {dropped.length > 0 ? (
              <Collapsible title={t("ideas.droppedSection", { count: dropped.length })}>{rows(dropped)}</Collapsible>
            ) : null}
          </View>
        )}
      </Enter>
    </Screen>
  );
}
