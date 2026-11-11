import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { fontFamily } from "../../../theme/tokens";
import { useTheme } from "../../../theme/useTheme";
import { HeaderBack } from "../../../ui/HeaderBack";

// Screens are pushed, so each has the native back control and (on iPhone) swipe-back.
export default function HomeStackLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        gestureEnabled: true,
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.accentStrong,
        headerTitleStyle: { fontFamily: fontFamily.extraBold, color: colors.text },
        headerLeft: (props) => <HeaderBack canGoBack={props.canGoBack} />,
      }}
    >
      <Stack.Screen name="index" options={{ title: t("common.appName") }} />
      <Stack.Screen name="projects/index" options={{ title: t("projects.title") }} />
      <Stack.Screen name="projects/new" options={{ title: t("projects.newTitle") }} />
      <Stack.Screen name="projects/[id]/index" options={{ title: t("projects.projectTitle") }} />
      <Stack.Screen name="projects/[id]/edit" options={{ title: t("projects.editTitle") }} />
    </Stack>
  );
}
