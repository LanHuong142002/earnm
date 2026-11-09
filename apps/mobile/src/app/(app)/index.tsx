import { Link } from "expo-router";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import { useTheme } from "../../theme/useTheme";
import { Enter } from "../../ui/Enter";
import { Screen } from "../../ui/Screen";

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { colors, typography, spacing } = useTheme();
  return (
    <Screen edges={["bottom"]}>
      {user ? (
        <Enter index={0}>
          <Text accessibilityRole="header" style={[typography.screenTitle, { color: colors.text }]}>
            {t("home.welcome", { name: user.displayName })}
          </Text>
        </Enter>
      ) : null}
      <Enter index={1}>
        <Link href="/settings" style={{ paddingVertical: spacing[2] }}>
          <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>
            {t("home.settingsLink")}
          </Text>
        </Link>
      </Enter>
    </Screen>
  );
}
