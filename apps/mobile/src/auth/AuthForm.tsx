import { Ionicons } from "@expo/vector-icons";
import type { TFunction } from "i18next";
import { Text, View } from "react-native";

import { ApiError } from "../lib/api";
import { useTheme } from "../theme/useTheme";

export function errorMessage(error: unknown, t: TFunction): string {
  const code = error instanceof ApiError ? error.code : "generic";
  return t(`errors.${code}`, { defaultValue: t("errors.generic") });
}

// Cup tile, screen title and one line of secondary text, shared by sign-in and sign-up.
export function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const { colors, typography, radius, spacing } = useTheme();
  return (
    <View style={{ gap: spacing[1], alignItems: "flex-start" }}>
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: radius.tile,
          backgroundColor: colors.tile,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: spacing[1],
        }}
      >
        <Ionicons name="cafe-outline" size={22} color={colors.accent} />
      </View>
      <Text accessibilityRole="header" style={[typography.screenTitle, { color: colors.text }]}>
        {title}
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>{subtitle}</Text>
    </View>
  );
}
