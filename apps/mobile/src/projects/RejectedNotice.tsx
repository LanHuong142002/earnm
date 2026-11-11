import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Enter } from "../ui/Enter";
import { PressableScale } from "../ui/PressableScale";
import { useProjects } from "./ProjectsProvider";

const REJECTED_REASON_KEY = {
  forbidden: "errors.forbidden",
  not_found: "errors.not_found",
  conflict: "errors.id_conflict",
  invalid: "errors.validation_failed",
} as const;

/** Tells the person a change couldn't be saved. Shown on every screen they can land on after it. */
export function RejectedNoticeBanner() {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing, layout } = useTheme();
  const { rejectedNotice, dismissRejectedNotice } = useProjects();
  if (!rejectedNotice) return null;
  return (
    <Enter index={0}>
      <View
        accessibilityRole="alert"
        style={{
          gap: spacing[0],
          padding: spacing[2],
          borderRadius: radius.card,
          backgroundColor: colors.dangerBg,
        }}
      >
        <Text style={[typography.bodyStrong, { color: colors.danger }]}>
          {rejectedNotice.projectName
            ? t("projects.rejected", { name: rejectedNotice.projectName })
            : t("projects.rejectedNoName")}
        </Text>
        <Text style={[typography.label, { color: colors.danger }]}>
          {t(REJECTED_REASON_KEY[rejectedNotice.reason])}
        </Text>
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
