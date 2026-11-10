import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import { useTheme } from "../../theme/useTheme";
import { Enter } from "../../ui/Enter";
import { Screen } from "../../ui/Screen";
import { TextLink } from "../../ui/TextLink";

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user, profileStatus } = useAuth();
  const { colors, typography, radius } = useTheme();
  return (
    <Screen edges={["bottom"]}>
      {profileStatus === "offline" ? (
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("home.offline")}</Text>
      ) : null}
      {!user && profileStatus === "loading" ? (
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
      ) : null}
      {user ? (
        <Enter index={0}>
          <Text accessibilityRole="header" style={[typography.screenTitle, { color: colors.text }]}>
            {t("home.welcome", { name: user.displayName })}
          </Text>
        </Enter>
      ) : null}
      <Enter index={1}>
        <TextLink href="/settings" label={t("home.settingsLink")} />
      </Enter>
    </Screen>
  );
}
