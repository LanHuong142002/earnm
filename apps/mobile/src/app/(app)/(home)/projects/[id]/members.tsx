import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../../../../theme/useTheme";
import { Screen } from "../../../../../ui/Screen";

// Placeholder until the members screen is built.
export default function MembersScreen() {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  return (
    <Screen edges={[]}>
      <Text accessibilityRole="header" style={[typography.screenTitle, { color: colors.text }]}>
        {t("members.title")}
      </Text>
    </Screen>
  );
}
