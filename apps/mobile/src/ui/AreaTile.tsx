import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "./PressableScale";

type IconName = ComponentProps<typeof Ionicons>["name"];

// The icon tile from DESIGN.md. `square` is for a row of three (Home); `wide` is for two columns,
// where a square would be too tall, so it is two control heights high instead.
export function AreaTile({
  icon,
  label,
  onPress,
  comingSoon,
  caption,
  shape = "square",
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  /** Disables the tile and shows this as its caption ("Coming soon"). */
  comingSoon?: string;
  /** A second line under the label, for an enabled tile (for example a count). */
  caption?: string;
  shape?: "square" | "wide";
}) {
  const { colors, typography, radius, spacing, layout, iconSize, disabled: disabledStyle } = useTheme();
  const disabled = comingSoon !== undefined;
  const second = comingSoon ?? caption;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={second ? `${label}, ${second}` : label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ flex: 1, gap: spacing[1], opacity: disabled ? disabledStyle.opacity : 1 }}
    >
      <View
        style={[
          {
            borderRadius: radius.tile,
            borderWidth: 1,
            borderColor: colors.tileBorder,
            backgroundColor: colors.tile,
            alignItems: "center",
            justifyContent: "center",
          },
          shape === "square" ? { aspectRatio: 1 } : { minHeight: layout.controlHeight * 2 },
        ]}
      >
        <Ionicons name={icon} size={iconSize.lg} color={colors.accent} />
      </View>
      <View style={{ alignItems: "center" }}>
        <Text style={[typography.label, { color: colors.text, textAlign: "center" }]}>{label}</Text>
        {second ? (
          <Text style={[typography.caption, { color: colors.textSecondary, textAlign: "center" }]}>{second}</Text>
        ) : null}
      </View>
    </PressableScale>
  );
}
