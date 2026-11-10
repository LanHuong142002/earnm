import { Ionicons } from "@expo/vector-icons";
import type { TFunction } from "i18next";
import { Text, View } from "react-native";

import { ApiError } from "../lib/api";
import { useTheme } from "../theme/useTheme";

export function errorMessage(error: unknown, t: TFunction): string {
  const code = error instanceof ApiError ? error.code : "generic";
  return t(`errors.${code}`, { defaultValue: t("errors.generic") });
}

export type AuthField = "displayName" | "email" | "password";

/** Which field an API error belongs to, and its message; field null means form-level. */
export function fieldError(
  error: unknown,
  t: TFunction,
): { field: AuthField | null; message: string } {
  const message = errorMessage(error, t);
  if (!(error instanceof ApiError)) return { field: null, message };
  if (error.code === "invalid_credentials") return { field: "password", message };
  if (error.code === "email_in_use") return { field: "email", message };
  if (error.code === "validation_failed") {
    // The API says "Invalid fields: email, password." -- take the first name we know.
    const names = (error.serverMessage ?? "").split(":")[1] ?? "";
    const known = names
      .split(/[\s,.]+/)
      .find((n): n is AuthField => n === "email" || n === "password" || n === "displayName");
    return { field: known ?? null, message };
  }
  return { field: null, message };
}

// Cup tile, screen title and one line of secondary text, shared by sign-in and sign-up.
export function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const { colors, typography, radius, spacing, tile, iconSize } = useTheme();
  return (
    <View style={{ gap: spacing[1], alignItems: "flex-start" }}>
      <View
        style={{
          width: tile.width,
          height: tile.height,
          borderRadius: radius.tile,
          backgroundColor: colors.tile,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: spacing[1],
        }}
      >
        <Ionicons name="cafe-outline" size={iconSize.md} color={colors.accent} />
      </View>
      <Text accessibilityRole="header" style={[typography.screenTitle, { color: colors.text }]}>
        {title}
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>{subtitle}</Text>
    </View>
  );
}
