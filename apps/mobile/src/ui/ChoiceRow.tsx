import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text } from "react-native";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "./PressableScale";

// A radio row inside a Card. The selected row shows a check icon, never colour alone.
export function ChoiceRow({
  label,
  selected,
  onPress,
  divider = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Hairline above the row; set it on every row but the first. */
  divider?: boolean;
}) {
  const { colors, typography, layout, iconSize } = useTheme();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      style={{
        minHeight: layout.controlHeight,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderTopColor: colors.border,
      }}
    >
      <Text style={[selected ? typography.bodyStrong : typography.body, { color: colors.text }]}>
        {label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={iconSize.md} color={colors.accent} /> : null}
    </PressableScale>
  );
}
