import { Redirect } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import { useProjects } from "../../projects/ProjectsProvider";
import { useTheme } from "../../theme/useTheme";
import { Collapsible } from "../../ui/Collapsible";
import { Enter } from "../../ui/Enter";
import { PressableScale } from "../../ui/PressableScale";
import { Screen } from "../../ui/Screen";
import { TextLink } from "../../ui/TextLink";

const REJECTED_REASON_KEY = {
  forbidden: "errors.forbidden",
  not_found: "errors.not_found",
  conflict: "errors.id_conflict",
  invalid: "errors.validation_failed",
} as const;

export default function HomeScreen() {
  const { t } = useTranslation();
  const { profileStatus } = useAuth();
  const {
    status,
    projects,
    currentProject,
    currentProjectId,
    waitingCount,
    rejectedNotice,
    dismissRejectedNotice,
  } = useProjects();
  const { colors, typography, radius, spacing, layout } = useTheme();

  const offline = status === "offline" || profileStatus === "offline";

  if (!currentProject) {
    // Nothing chosen, or the chosen project is gone: pick from the list. While the first
    // refresh is still running and nothing is cached, wait instead of redirecting.
    const settled = status !== "loading" || (projects.length > 0 && currentProjectId === null);
    if (settled) return <Redirect href="/projects" />;
    return (
      <Screen edges={["bottom"]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            height: typography.screenTitle.lineHeight,
            width: "60%",
            borderRadius: radius.field,
            backgroundColor: colors.field,
          }}
        />
      </Screen>
    );
  }

  const isOwner = currentProject.role === "owner";

  return (
    <Screen edges={["bottom"]}>
      {offline ? (
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("home.offline")}</Text>
      ) : null}
      {waitingCount > 0 ? (
        <Text style={[typography.label, { color: colors.textSecondary }]}>
          {t("projects.waiting", { count: waitingCount })}
        </Text>
      ) : null}
      {rejectedNotice ? (
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
              <Text style={[typography.bodyStrong, { color: colors.danger }]}>
                {t("projects.dismiss")}
              </Text>
            </PressableScale>
          </View>
        </Enter>
      ) : null}
      <Enter index={1}>
        <View style={{ gap: spacing[0] }}>
          <Text accessibilityRole="header" style={[typography.screenTitle, { color: colors.text }]}>
            {currentProject.name}
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            {t("projects.currencyLine", { currency: currentProject.currency })}
          </Text>
        </View>
      </Enter>
      <Enter index={2}>
        <Collapsible title={t("projects.details")}>
          <Text style={[typography.body, { color: colors.text }]}>
            {currentProject.description !== ""
              ? currentProject.description
              : t("projects.noDescription")}
          </Text>
        </Collapsible>
      </Enter>
      <Enter index={3}>
        <View>
          <TextLink href="/projects" label={t("projects.switch")} />
          {isOwner ? (
            <TextLink
              href={{ pathname: "/projects/[id]/edit", params: { id: currentProject.id } }}
              label={t("projects.edit")}
            />
          ) : null}
          <TextLink href="/settings" label={t("home.settingsLink")} />
        </View>
      </Enter>
    </Screen>
  );
}
