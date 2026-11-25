import { Ionicons } from "@expo/vector-icons";
import { Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { useNotificationSettings } from "./useNotificationSettings";

/** The "Thông báo hoạt động" row on a project's screen: the switch is on unless this project is muted (R26). */
export function ProjectMuteRow({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { t } = useTranslation();
  const { colors, typography, spacing, layout, iconSize, disabled: disabledStyle } = useTheme();
  const { settings, saveFailed, setMuted, muted: isMuted } = useNotificationSettings();
  const muted = isMuted(projectId);

  return (
    <View style={{ gap: spacing[1] }}>
      <Card>
        <View
          style={{
            minHeight: layout.controlHeight,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing[2],
            opacity: settings === null ? disabledStyle.opacity : 1,
          }}
        >
          <Ionicons
            name={muted ? "notifications-off-outline" : "notifications-outline"}
            size={iconSize.lg}
            color={muted ? colors.textSecondary : colors.accent}
          />
          <View style={{ flex: 1 }}>
            <Text style={[typography.bodyStrong, { color: colors.text }]}>{t("notifications.project.title")}</Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t(muted ? "notifications.project.off" : "notifications.project.on")}
            </Text>
          </View>
          <Switch
            accessibilityLabel={t("notifications.project.switchLabel", { name: projectName })}
            disabled={settings === null}
            value={!muted}
            onValueChange={(on) => void setMuted(projectId, !on)}
            trackColor={{ false: colors.border, true: colors.accentStrong }}
            thumbColor={colors.onAccent}
          />
        </View>
      </Card>
      {saveFailed ? <ErrorText message={t("notifications.saveFailed")} /> : null}
    </View>
  );
}
