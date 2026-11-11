import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";

import { fontFamily } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";

// Two tabs, each with its own stack, so switching tabs keeps each where the person left it.
export default function AppLayout() {
  const { t } = useTranslation();
  const { colors, iconSize } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.accentStrong,
        headerTitleStyle: { fontFamily: fontFamily.extraBold, color: colors.text },
        tabBarActiveTintColor: colors.accentStrong,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fontFamily.semiBold },
      }}
    >
      <Tabs.Screen
        name="(home)"
        options={{
          title: t("tabs.home"),
          headerShown: false,
          tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={iconSize.md} color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t("tabs.account"),
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={iconSize.md} color={String(color)} />,
        }}
      />
    </Tabs>
  );
}
