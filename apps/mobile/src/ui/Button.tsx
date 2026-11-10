import { ActivityIndicator, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "./PressableScale";

type Variant = "primary" | "secondary" | "danger";

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, radius, spacing } = useTheme();
  const primary = variant === "primary";
  const textColor = primary ? colors.onAccent : variant === "danger" ? colors.danger : colors.text;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading, busy: loading }}
      disabled={loading}
      onPress={onPress}
      style={{
        minHeight: layout.controlHeight,
        borderRadius: radius.button,
        backgroundColor: primary ? colors.accentStrong : colors.field,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing[3],
      }}
    >
      {loading ? (
        <ActivityIndicator accessibilityLabel={t("common.loading")} color={textColor} />
      ) : (
        <Text style={[typography.bodyStrong, { color: textColor }]}>{label}</Text>
      )}
    </PressableScale>
  );
}
