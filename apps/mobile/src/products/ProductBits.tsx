import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import type { ReactNode } from "react";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";

/** A quiet line of small text (hints, notes). */
export function Hint({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const { colors, typography } = useTheme();
  return <Text style={[typography.caption, { color: colors.textSecondary }, style]}>{children}</Text>;
}

/** The "Mặc định" chip next to a default line. */
export function DefaultChip({ label }: { label: string }) {
  const { colors, typography, radius, spacing } = useTheme();
  return (
    <View
      style={{
        paddingVertical: spacing[0] / 2,
        paddingHorizontal: spacing[0] + 2,
        borderRadius: radius.pill,
        backgroundColor: colors.tile,
      }}
    >
      <Text style={[typography.caption, { color: colors.accentStrong }]}>{label}</Text>
    </View>
  );
}

/** A tick box with a full control-height touch target around it. */
export function Tick({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const { colors, radius, layout, iconSize } = useTheme();
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={{ width: layout.controlHeight, minHeight: layout.controlHeight, alignItems: "center", justifyContent: "center" }}
    >
      <View
        style={{
          width: iconSize.sm,
          height: iconSize.sm,
          borderRadius: radius.checkbox,
          borderWidth: 1.5,
          borderColor: on ? colors.accent : colors.placeholder,
          backgroundColor: on ? colors.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {on ? <Ionicons name="checkmark" size={iconSize.sm - 6} color={colors.onAccent} /> : null}
      </View>
    </PressableScale>
  );
}

/** A label and a value on one row of a card; `divider` puts a hairline above it. */
export function SummaryRow({
  label,
  value,
  valueColor,
  divider = false,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  valueColor?: string;
  divider?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors, typography, layout, spacing } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? `${label}, ${value}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing[1],
        minHeight: layout.controlHeight + spacing[0],
        borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderTopColor: colors.border,
      }}
    >
      <Text style={[typography.body, { color: colors.text }]}>{label}</Text>
      <Text style={[typography.bodyStrong, { color: valueColor ?? colors.text }]}>{value}</Text>
    </View>
  );
}

/** A text link (accent, 44pt high). */
export function LinkRow({
  label,
  onPress,
  danger = false,
  center = false,
  divider = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  center?: boolean;
  divider?: boolean;
}) {
  const { colors, typography, layout } = useTheme();
  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: layout.controlHeight,
        justifyContent: "center",
        alignItems: center ? "center" : "flex-start",
        borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderTopColor: colors.border,
      }}
    >
      <Text style={[typography.bodyStrong, { color: danger ? colors.danger : colors.accentStrong }]}>{label}</Text>
    </PressableScale>
  );
}
