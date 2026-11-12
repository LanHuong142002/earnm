import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { PressableScale } from "../ui/PressableScale";
import { formatDue, isOverdue, type DueLanguage } from "./dueDate";
import type { Task } from "./types";

// Assignee first names shown before "+n".
const NAMES_SHOWN = 3;

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

/** "An, Binh, Chi +2" */
export function assigneeLine(task: Task, moreLabel: (count: number) => string): string {
  const names = task.assignees.slice(0, NAMES_SHOWN).map((a) => firstName(a.displayName));
  const extra = task.assignees.length - NAMES_SHOWN;
  return extra > 0 ? `${names.join(", ")} ${moreLabel(extra)}` : names.join(", ");
}

export function TaskCard({
  task,
  now,
  onOpen,
  onChangeStatus,
}: {
  task: Task;
  now: Date;
  onOpen: () => void;
  onChangeStatus: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, radius, spacing, layout, iconSize } = useTheme();
  const lang: DueLanguage = i18n.language === "vi" ? "vi" : "en";
  const done = task.status === "done";
  const overdue = isOverdue(task, now);
  const statusName = t(`tasks.status.${task.status}`);
  const assignees = assigneeLine(task, (count) => t("tasks.moreAssignees", { count }));
  const due = task.dueDate !== null ? formatDue(task.dueDate, task.dueTime, lang, t) : null;

  const label = [
    t("tasks.cardLabel", { title: task.title, status: statusName }),
    assignees !== "" ? t("tasks.assignedTo", { names: assignees }) : null,
    due !== null ? t(overdue ? "tasks.overdueOn" : "tasks.dueOn", { date: due }) : null,
  ]
    .filter((part) => part !== null)
    .join(". ");

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onOpen}
      // The pill is nested in this pressable, so screen readers reach it as an action instead.
      accessibilityActions={[{ name: "changeStatus", label: t("tasks.changeStatus") }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "changeStatus") onChangeStatus();
      }}
    >
      <Card>
        <View style={{ gap: spacing[0] }}>
          <Text
            style={[
              typography.bodyStrong,
              { color: done ? colors.textSecondary : colors.text, textDecorationLine: done ? "line-through" : "none" },
            ]}
            numberOfLines={2}
          >
            {task.title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1] }}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t("tasks.statusPillLabel", { status: statusName })}
              onPress={onChangeStatus}
              style={{ minHeight: layout.controlHeight, justifyContent: "center" }}
            >
              <View
                style={{
                  backgroundColor: colors.tile,
                  borderRadius: radius.pill,
                  paddingVertical: spacing[0],
                  paddingHorizontal: spacing[1],
                }}
              >
                <Text style={[typography.caption, { fontFamily: typography.label.fontFamily, color: colors.accentStrong }]}>
                  {statusName}
                </Text>
              </View>
            </PressableScale>
            {assignees !== "" ? (
              <Text style={[typography.caption, { color: colors.textSecondary, flexShrink: 1 }]} numberOfLines={1}>
                {assignees}
              </Text>
            ) : null}
          </View>
          {due !== null ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
              <Ionicons
                name={overdue ? "alert-circle-outline" : "calendar-outline"}
                size={iconSize.sm}
                color={overdue ? colors.danger : colors.textSecondary}
              />
              <Text style={[typography.caption, { color: overdue ? colors.danger : colors.textSecondary, flexShrink: 1 }]}>
                {overdue ? `${t("tasks.overdue")} · ${due}` : due}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>
    </PressableScale>
  );
}
