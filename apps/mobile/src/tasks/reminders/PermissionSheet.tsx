import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { SheetFrame } from "../SheetFrame";
import { requestPermission } from "./notifications";
import { signalSchedule } from "./scheduleSignal";

/**
 * Explains why the phone wants to send notifications, before iOS asks (mockup 3a, R15). The reminder is already saved,
 * so "Để sau" just closes. "Tiếp tục" shows iOS's own question, then plans the notifications again.
 */
export function PermissionSheet() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing, radius, iconSize } = useTheme();
  const [busy, setBusy] = useState(false);

  async function proceed() {
    setBusy(true);
    try {
      await requestPermission();
      signalSchedule();
    } catch {
      // The system could not ask: nothing to do, the reminder is saved.
    } finally {
      setBusy(false);
      router.back();
    }
  }

  return (
    <SheetFrame title="">
      <View style={{ alignItems: "center", gap: spacing[2] }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.tile,
            backgroundColor: colors.tile,
            borderWidth: 1,
            borderColor: colors.tileBorder,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="notifications-outline" size={iconSize.xl} color={colors.accent} />
        </View>
        <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text, textAlign: "center" }]}>
          {t("tasks.reminders.permission.title")}
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary, textAlign: "center" }]}>{t("tasks.reminders.permission.body")}</Text>
      </View>
      <View style={{ gap: spacing[0] }}>
        <Button label={t("tasks.reminders.permission.continue")} loading={busy} onPress={() => void proceed()} />
        <Button label={t("tasks.reminders.permission.later")} variant="secondary" disabled={busy} onPress={() => router.back()} />
      </View>
    </SheetFrame>
  );
}
