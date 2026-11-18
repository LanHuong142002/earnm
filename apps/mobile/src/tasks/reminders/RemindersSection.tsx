import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, Linking, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTapOnce } from "../../projects/useProjectNav";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { PressableScale } from "../../ui/PressableScale";
import type { Task } from "../types";
import { MAX_REMINDERS_PER_TASK } from "./formState";
import { permissionState } from "./notifications";
import { showPermissionNotice, type PermissionState } from "./notificationLogic";
import { onScheduleSignal } from "./scheduleSignal";
import { reminderRowLines } from "./rowLines";
import { usePeople } from "./usePeople";
import { useReminderT } from "./useReminderT";
import { useTaskReminders } from "./useTaskReminders";

/** The "Nhắc nhở" section under the task's info card (mockups 1a-1d, 4c, 4d). */
export function RemindersSection({ projectId, task }: { projectId: string; task: Task }) {
  const { t } = useTranslation();
  const rt = useReminderT();
  const router = useRouter();
  const once = useTapOnce();
  const { colors, typography, layout, radius, spacing, iconSize } = useTheme();
  const { names, meId } = usePeople(projectId, []);
  const { reminders, loading } = useTaskReminders({ projectId, taskId: task.id, meId });
  const [now] = useState(() => new Date());
  const [permission, setPermission] = useState<PermissionState | null>(null);

  // Whether iOS lets this phone notify: read when the section shows, when the app returns (Settings may have changed it),
  // and after the explanation sheet.
  useEffect(() => {
    let alive = true;
    const read = () => void permissionState().then((p) => alive && setPermission(p)).catch(() => undefined);
    read();
    const off = onScheduleSignal(read);
    const app = AppState.addEventListener("change", (s) => s === "active" && read());
    return () => {
      alive = false;
      off();
      app.remove();
    };
  }, []);

  const full = reminders.length >= MAX_REMINDERS_PER_TASK;
  const done = task.status === "done";
  const open = (reminderId?: string) =>
    once(() =>
      reminderId === undefined
        ? router.push({ pathname: "/projects/[id]/tasks/[taskId]/reminders/new", params: { id: projectId, taskId: task.id } })
        : router.push({ pathname: "/projects/[id]/tasks/[taskId]/reminders/[reminderId]", params: { id: projectId, taskId: task.id, reminderId } }),
    );

  return (
    <View style={{ gap: spacing[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1], minHeight: layout.controlHeight }}>
        <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text }]}>
          {t("tasks.reminders.heading")}
        </Text>
        <Text style={[typography.label, { flex: 1, color: colors.textSecondary }]}>
          {reminders.length > 0 ? t("tasks.reminders.count", { count: reminders.length, max: MAX_REMINDERS_PER_TASK }) : ""}
        </Text>
        {full ? (
          <Text accessibilityLabel={t("tasks.reminders.fullA11y")} style={[typography.label, { color: colors.textSecondary }]}>
            {t("tasks.reminders.full")}
          </Text>
        ) : reminders.length > 0 ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("tasks.reminders.addA11y")}
            onPress={() => open()}
            style={{ minHeight: layout.controlHeight, justifyContent: "center" }}
          >
            <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("tasks.reminders.add")}</Text>
          </PressableScale>
        ) : null}
      </View>

      {done && reminders.length > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
          <Ionicons name="checkmark" size={iconSize.sm} color={colors.textSecondary} />
          <Text style={[typography.caption, { color: colors.textSecondary, flexShrink: 1 }]}>{t("tasks.reminders.stoppedDone")}</Text>
        </View>
      ) : null}

      {showPermissionNotice(permission, reminders.length) ? (
        <View style={{ backgroundColor: colors.dangerBg, borderRadius: radius.field, padding: spacing[2], gap: spacing[0] }}>
          <Text style={[typography.label, { color: colors.danger }]}>{t("tasks.reminders.notice")}</Text>
          <PressableScale
            accessibilityRole="link"
            accessibilityLabel={t("tasks.reminders.openSettings")}
            onPress={() => void Linking.openSettings()}
            style={{ minHeight: layout.controlHeight, flexDirection: "row", alignItems: "center", gap: spacing[0] }}
          >
            <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("tasks.reminders.openSettings")}</Text>
            <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.accentStrong} />
          </PressableScale>
        </View>
      ) : null}

      {loading ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ height: layout.controlHeight, borderRadius: radius.field, backgroundColor: colors.field }}
        />
      ) : reminders.length === 0 ? (
        <>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{t("tasks.reminders.emptyBody")}</Text>
          <Button label={t("tasks.reminders.emptyAdd")} variant="secondary" onPress={() => open()} />
        </>
      ) : (
        <Card flush>
          {reminders.map((reminder, i) => {
            const row = reminderRowLines(reminder, names, done, now, rt);
            const muted = row.stopped;
            return (
              <PressableScale
                key={reminder.id}
                accessibilityRole="button"
                accessibilityLabel={`${row.title}. ${row.subtitle}`}
                accessibilityHint={t("tasks.reminders.editA11y")}
                onPress={() => open(reminder.id)}
                style={{
                  minHeight: 56,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing[2],
                  paddingVertical: spacing[1],
                  paddingHorizontal: spacing[2],
                  borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.field,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: muted ? colors.field : colors.tile,
                    borderWidth: 1,
                    borderColor: muted ? colors.field : colors.tileBorder,
                  }}
                >
                  <Ionicons name="notifications-outline" size={iconSize.sm} color={muted ? colors.textSecondary : colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyStrong, { color: muted ? colors.textSecondary : colors.text }]}>{row.title}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
                    {row.waiting ? (
                      <>
                        <Ionicons name="time-outline" size={typography.caption.lineHeight} color={colors.textSecondary} />
                        <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("tasks.reminders.waiting")}</Text>
                        {row.subtitle !== "" ? <Text style={[typography.caption, { color: colors.textSecondary }]}>·</Text> : null}
                      </>
                    ) : null}
                    {row.subtitle !== "" ? (
                      <Text style={[typography.caption, { color: colors.textSecondary, flexShrink: 1 }]}>{row.subtitle}</Text>
                    ) : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} />
              </PressableScale>
            );
          })}
        </Card>
      )}
    </View>
  );
}
