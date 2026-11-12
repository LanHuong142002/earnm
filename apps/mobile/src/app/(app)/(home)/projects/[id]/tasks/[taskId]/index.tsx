import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTapOnce } from "../../../../../../../projects/useProjectNav";
import { OfflineNote } from "../../../../../../../projects/OfflineNote";
import { formatDue, isOverdue, type DueLanguage } from "../../../../../../../tasks/dueDate";
import { showStatusPicker } from "../../../../../../../tasks/StatusPicker";
import { TaskRejectedNotice } from "../../../../../../../tasks/TaskRejectedNotice";
import { useTasks } from "../../../../../../../tasks/TasksProvider";
import { useTaskScreen } from "../../../../../../../tasks/useTaskScreen";
import { useTheme } from "../../../../../../../theme/useTheme";
import { Button } from "../../../../../../../ui/Button";
import { Card } from "../../../../../../../ui/Card";
import { Enter } from "../../../../../../../ui/Enter";
import { PressableScale } from "../../../../../../../ui/PressableScale";
import { Screen } from "../../../../../../../ui/Screen";

export default function TaskDetailsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const once = useTapOnce();
  const { colors, typography, radius, spacing, layout, iconSize } = useTheme();
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  const { setStatus } = useTasks();
  const { project, task, view, deleting, canDelete, confirmDelete } = useTaskScreen(id, taskId);
  // Judged against the moment the screen opened.
  const [now] = useState(() => new Date());

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

  const lang: DueLanguage = i18n.language === "vi" ? "vi" : "en";
  const statusName = t(`tasks.status.${task.status}`);
  const overdue = isOverdue(task, now);
  const due = task.dueDate !== null ? formatDue(task.dueDate, task.dueTime, lang, t) : null;
  const names = task.assignees.map((a) => a.displayName).join(", ");

  const caption = (text: string) => <Text style={[typography.label, { color: colors.textSecondary }]}>{text}</Text>;

  return (
    <Screen edges={[]}>
      <OfflineNote />
      <TaskRejectedNotice />
      <Enter index={0}>
        <View style={{ gap: spacing[2] }}>
          <Text accessibilityRole="header" style={[typography.screenTitle, { color: colors.text }]}>
            {task.title}
          </Text>
          <Card>
            <View style={{ gap: spacing[2] }}>
              <View style={{ gap: spacing[0] }}>
                {caption(t("tasks.statusLabel"))}
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={t("tasks.statusPillLabel", { status: statusName })}
                  onPress={() => showStatusPicker(t, task.status, (next) => void setStatus(project.id, task.id, next))}
                  style={{ minHeight: layout.controlHeight, flexDirection: "row", alignItems: "center", gap: spacing[0] }}
                >
                  <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{statusName}</Text>
                  <Ionicons name="chevron-down" size={iconSize.sm} color={colors.accentStrong} />
                </PressableScale>
              </View>
              <View style={{ gap: spacing[0] }}>
                {caption(t("tasks.dueLabel"))}
                {due === null ? (
                  <Text style={[typography.body, { color: colors.textSecondary }]}>{t("tasks.dueNone")}</Text>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
                    <Ionicons
                      name={overdue ? "alert-circle-outline" : "calendar-outline"}
                      size={iconSize.sm}
                      color={overdue ? colors.danger : colors.textSecondary}
                    />
                    <Text style={[typography.body, { color: overdue ? colors.danger : colors.text, flexShrink: 1 }]}>
                      {overdue ? `${t("tasks.overdue")} · ${due}` : due}
                    </Text>
                  </View>
                )}
              </View>
              <View style={{ gap: spacing[0] }}>
                {caption(t("tasks.assigneesLabel"))}
                <Text style={[typography.body, { color: names === "" ? colors.textSecondary : colors.text }]}>
                  {names === "" ? t("tasks.assigneesNone") : names}
                </Text>
              </View>
              <View style={{ gap: spacing[0] }}>
                {caption(t("tasks.descriptionLabel"))}
                <Text
                  style={[typography.body, { color: task.description === "" ? colors.textSecondary : colors.text }]}
                >
                  {task.description === "" ? t("tasks.descriptionNone") : task.description}
                </Text>
              </View>
            </View>
          </Card>
        </View>
      </Enter>
      <Enter index={1}>
        <Button
          label={t("tasks.editButton")}
          onPress={() =>
            once(() =>
              router.push({ pathname: "/projects/[id]/tasks/[taskId]/edit", params: { id: project.id, taskId: task.id } }),
            )
          }
        />
      </Enter>
      {canDelete ? (
        <Enter index={2}>
          {/* Set apart from Edit, with room below, so it can't be hit by mistake. */}
          <View
            style={{
              marginTop: spacing[4],
              marginBottom: spacing[6],
              paddingTop: spacing[5],
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <Button label={t("tasks.deleteButton")} variant="danger" onPress={confirmDelete} />
          </View>
        </Enter>
      ) : null}
    </Screen>
  );
}
