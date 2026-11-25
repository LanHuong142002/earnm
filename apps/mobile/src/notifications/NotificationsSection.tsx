import { StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { NOTIFICATION_TYPES } from "./api";
import { useNotificationSettings } from "./useNotificationSettings";

const PLACEHOLDER_HEIGHT = 260;

/** The "Thông báo" block of the Account screen: one switch per activity type (R24, R25). */
export function NotificationsSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing, layout, radius } = useTheme();
  const { settings, status, saveFailed, setType } = useNotificationSettings();

  return (
    <View style={{ gap: spacing[1] }}>
      <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text }]}>
        {t("notifications.title")}
      </Text>
      {settings === null ? (
        status === "error" ? (
          <ErrorText message={t("notifications.loadFailed")} />
        ) : (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ height: PLACEHOLDER_HEIGHT, borderRadius: radius.card, backgroundColor: colors.field }}
          />
        )
      ) : (
        <>
          <Card>
            {NOTIFICATION_TYPES.map((type, i) => {
              const label = t(`notifications.types.${type}`);
              return (
                <View
                  key={type}
                  style={{
                    minHeight: layout.controlHeight,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: spacing[2],
                    borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0,
                    borderTopColor: colors.border,
                  }}
                >
                  <Text style={[typography.body, { color: colors.text, flex: 1 }]}>{label}</Text>
                  <Switch
                    accessibilityLabel={label}
                    value={settings.types[type]}
                    onValueChange={(enabled) => void setType(type, enabled)}
                    trackColor={{ false: colors.border, true: colors.accentStrong }}
                    thumbColor={colors.onAccent}
                  />
                </View>
              );
            })}
          </Card>
          {saveFailed ? <ErrorText message={t("notifications.saveFailed")} /> : null}
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("notifications.caption")}</Text>
        </>
      )}
    </View>
  );
}
