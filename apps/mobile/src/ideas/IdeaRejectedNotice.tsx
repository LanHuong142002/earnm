import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Enter } from "../ui/Enter";
import { PressableScale } from "../ui/PressableScale";
import { useIdeas } from "./IdeasProvider";
import { ideaNoticeKeys } from "./outcomes";

/** Tells the person an idea change could not be saved (spec R22). Same look as the task notice. */
export function IdeaRejectedNotice() {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing, layout } = useTheme();
  const { rejectedNotice, dismissRejectedNotice } = useIdeas();
  if (!rejectedNotice) return null;
  const keys = ideaNoticeKeys(rejectedNotice);
  return (
    <Enter index={0}>
      <View
        accessibilityRole="alert"
        style={{ gap: spacing[0], padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.dangerBg }}
      >
        <Text style={[typography.bodyStrong, { color: colors.danger }]}>
          {t(keys.headline, { title: rejectedNotice.ideaTitle ?? "" })}
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
