import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { fontFamily } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";

export default function AppLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.accentStrong,
        headerTitleStyle: { fontFamily: fontFamily.extraBold, color: colors.text },
      }}
    >
      <Stack.Screen name="index" options={{ title: t("common.appName") }} />
      <Stack.Screen name="projects/index" options={{ title: t("projects.title") }} />
      <Stack.Screen name="projects/new" options={{ title: t("projects.newTitle") }} />
      <Stack.Screen name="projects/[id]/edit" options={{ title: t("projects.editTitle") }} />
      <Stack.Screen name="settings" options={{ title: t("settings.title") }} />
    </Stack>
  );
}
