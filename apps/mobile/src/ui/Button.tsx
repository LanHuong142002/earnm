import { ActivityIndicator, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "./PressableScale";

type Variant = "primary" | "secondary" | "soft" | "danger";

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, radius, spacing, disabled: disabledStyle } = useTheme();
  const primary = variant === "primary";
  const textColor = primary ? colors.onAccent : variant === "danger" ? colors.danger : variant === "soft" ? colors.accentStrong : colors.text;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading || disabled, busy: loading }}
      disabled={loading || disabled}
      onPress={onPress}
      style={{
        minHeight: layout.controlHeight,
        borderRadius: radius.button,
        backgroundColor: primary ? colors.accentStrong : variant === "soft" ? colors.tile : colors.field,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing[3],
        opacity: disabled && !loading ? disabledStyle.opacity : 1,
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
