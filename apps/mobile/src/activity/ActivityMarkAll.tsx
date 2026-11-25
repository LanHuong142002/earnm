import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import { useActivity } from "./ActivityProvider";

/** "Đọc hết" at the right of the Activity header: marks every row read. Dimmed while nothing is unread. */
export function ActivityMarkAll() {
  const { t } = useTranslation();
  const { colors, typography, layout, spacing, disabled: disabledStyle } = useTheme();
  const { hasUnread, markAllAsRead } = useActivity();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t("activity.markAllRead")}
      accessibilityState={{ disabled: !hasUnread }}
      disabled={!hasUnread}
      onPress={markAllAsRead}
      style={{
        minHeight: layout.controlHeight,
        minWidth: layout.controlHeight,
        paddingHorizontal: spacing[1],
        alignItems: "center",
        justifyContent: "center",
        opacity: hasUnread ? 1 : disabledStyle.opacity,
      }}
    >
      <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("activity.markAllRead")}</Text>
    </PressableScale>
  );
}
