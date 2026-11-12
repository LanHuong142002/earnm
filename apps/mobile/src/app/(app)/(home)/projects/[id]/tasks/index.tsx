import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../../../../../auth/AuthProvider";
import { OfflineNote } from "../../../../../../projects/OfflineNote";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useGoToProjectList, useTapOnce } from "../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../projects/routing";
import { visibleTasks } from "../../../../../../tasks/counts";
import { DEFAULT_FILTERS } from "../../../../../../tasks/filters";
import { FilterBar } from "../../../../../../tasks/FilterBar";
import { showStatusPicker } from "../../../../../../tasks/StatusPicker";
import { TaskCard } from "../../../../../../tasks/TaskCard";
import { TaskRejectedNotice } from "../../../../../../tasks/TaskRejectedNotice";
import { useTasks } from "../../../../../../tasks/TasksProvider";
import type { Task } from "../../../../../../tasks/types";
import { useTheme } from "../../../../../../theme/useTheme";
import { Button } from "../../../../../../ui/Button";
import { Collapsible } from "../../../../../../ui/Collapsible";
import { Enter } from "../../../../../../ui/Enter";
import { Screen } from "../../../../../../ui/Screen";

export default function TaskListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const once = useTapOnce();
  const focused = useIsFocused();
  const { colors, typography, radius, spacing, layout } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { status, projects } = useProjects();
  const tasks = useTasks();
  const { ready, refresh, tasksFor, filtersFor, setFilters, setStatus } = tasks;
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);

  // Bumped on focus so "overdue" and "due soon" are judged against the time you came back.
  const [now, setNow] = useState(() => new Date());
  // True once a refresh has answered at least once, so the first load shows blocks, not "no tasks".
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  // Show the cached list at once and fetch the server's version each time the screen comes back (R14).
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      if (!ready || !id) return;
      void refresh(id)
        .catch(() => undefined)
        .then(() => setSettled(true));
    }, [ready, refresh, id]),
  );

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

  const all = tasksFor(project.id);
  const filters = ready ? filtersFor(project.id) : DEFAULT_FILTERS;
  const shown = visibleTasks(all, filters, user?.id ?? "", now);
  const loading = !ready || (all.length === 0 && !settled);
  const filtered = filters.status !== "all" || filters.mine || filters.onlyMe || filters.dueSoon;

  const open = (task: Task) =>
    once(() =>
      router.push({ pathname: "/projects/[id]/tasks/[taskId]", params: { id: project.id, taskId: task.id } }),
    );
  const card = (task: Task) => (
    <TaskCard
      key={task.id}
      task={task}
      now={now}
      onOpen={() => open(task)}
      onChangeStatus={() => showStatusPicker(t, task.status, (next) => void setStatus(project.id, task.id, next))}
    />
  );

  return (
    <Screen edges={[]}>
      <OfflineNote />
      <TaskRejectedNotice />
      <Enter index={1}>
        <Button
          label={t("tasks.newTask")}
          onPress={() => once(() => router.push({ pathname: "/projects/[id]/tasks/new", params: { id: project.id } }))}
        />
      </Enter>
      <Enter index={2}>
        <FilterBar filters={filters} onChange={(next) => void setFilters(project.id, next)} />
      </Enter>
      <Enter index={3}>
        {loading ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: spacing[2] }}>
            {[0, 1].map((n) => (
              <View
                key={n}
                style={{ height: layout.controlHeight * 2, borderRadius: radius.card, backgroundColor: colors.field }}
              />
            ))}
          </View>
        ) : shown.total === 0 ? (
          <View style={{ gap: spacing[1] }}>
            <View style={{ gap: spacing[0] }}>
              <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text }]}>
                {t(filtered ? "tasks.noMatchTitle" : "tasks.emptyTitle")}
              </Text>
              <Text style={[typography.body, { color: colors.textSecondary }]}>
                {t(filtered ? "tasks.noMatchBody" : "tasks.emptyBody")}
              </Text>
            </View>
            {filtered ? (
              <Button
                label={t("tasks.clearFilters")}
                variant="secondary"
                onPress={() => void setFilters(project.id, DEFAULT_FILTERS)}
              />
            ) : null}
          </View>
        ) : (
          <View style={{ gap: spacing[2] }}>
            {shown.open.map(card)}
            {shown.done.length > 0 ? (
              <Collapsible title={t("tasks.doneSection", { count: shown.done.length })}>
                <View style={{ gap: spacing[2] }}>{shown.done.map(card)}</View>
              </Collapsible>
            ) : null}
          </View>
        )}
      </Enter>
    </Screen>
  );
}
