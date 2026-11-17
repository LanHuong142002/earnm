import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import type { Progress } from "./progress";

/** "3/7 items" with a small checkbox icon. */
export function ProgressCount({ progress }: { progress: Progress }) {
  const { t } = useTranslation();
  const { colors, typography, spacing, iconSize } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={t("tasks.progressA11y", { done: progress.done, total: progress.total })}
      style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}
    >
      <Ionicons name="checkbox-outline" size={iconSize.sm} color={colors.textSecondary} />
      <Text style={[typography.caption, { color: colors.textSecondary, fontFamily: typography.label.fontFamily }]}>
        {t("tasks.progressCount", { done: progress.done, total: progress.total })}
      </Text>
    </View>
  );
}
