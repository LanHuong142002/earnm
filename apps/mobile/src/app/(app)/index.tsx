import { Redirect } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import { RejectedNoticeBanner } from "../../projects/RejectedNotice";
import { useProjects } from "../../projects/ProjectsProvider";
import { useTheme } from "../../theme/useTheme";
import { Collapsible } from "../../ui/Collapsible";
import { Enter } from "../../ui/Enter";
import { Screen } from "../../ui/Screen";
import { TextLink } from "../../ui/TextLink";

export default function HomeScreen() {
  const { t } = useTranslation();
  const { profileStatus } = useAuth();
  const { status, projects, currentProject, currentProjectId, waitingCount } = useProjects();
  const { colors, typography, radius, spacing } = useTheme();

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
      <RejectedNoticeBanner />
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
