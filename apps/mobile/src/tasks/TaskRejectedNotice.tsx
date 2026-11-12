import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Enter } from "../ui/Enter";
import { PressableScale } from "../ui/PressableScale";
import { noticeKeys } from "./outcomes";
import { useTasks } from "./TasksProvider";

/** Tells the person a task change could not be saved (spec R17). Same look as the project notice. */
export function TaskRejectedNotice() {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing, layout } = useTheme();
  const { rejectedNotice, dismissRejectedNotice } = useTasks();
  if (!rejectedNotice) return null;
  const keys = noticeKeys(rejectedNotice);
  return (
    <Enter index={0}>
      <View
        accessibilityRole="alert"
        style={{ gap: spacing[0], padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.dangerBg }}
      >
        <Text style={[typography.bodyStrong, { color: colors.danger }]}>
          {t(keys.headline, { title: rejectedNotice.taskTitle ?? "" })}
        </Text>
        <Text style={[typography.label, { color: colors.danger }]}>{t(keys.reason)}</Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("projects.dismiss")}
          onPress={dismissRejectedNotice}
          style={{ minHeight: layout.controlHeight, justifyContent: "center" }}
        >
          <Text style={[typography.bodyStrong, { color: colors.danger }]}>{t("projects.dismiss")}</Text>
        </PressableScale>
      </View>
    </Enter>
  );
}
