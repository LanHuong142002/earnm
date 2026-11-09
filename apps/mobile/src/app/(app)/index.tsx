import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import { useTheme } from "../../theme/useTheme";
import { Enter } from "../../ui/Enter";
import { Screen } from "../../ui/Screen";
import { TextLink } from "../../ui/TextLink";

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { colors, typography } = useTheme();
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
        <TextLink href="/settings" label={t("home.settingsLink")} />
      </Enter>
    </Screen>
  );
}
