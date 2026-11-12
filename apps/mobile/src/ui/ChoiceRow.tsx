import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "./PressableScale";

// A radio row inside a Card. The selected row shows a check icon, never colour alone.
export function ChoiceRow({
  label,
  selected,
  onPress,
  divider = false,
  caption,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Hairline above the row; set it on every row but the first. */
  divider?: boolean;
  /** Small line under the label. */
  caption?: string;
  disabled?: boolean;
}) {
  const { colors, typography, layout, iconSize } = useTheme();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected, disabled }}
      accessibilityHint={caption}
      disabled={disabled}
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
      <View style={{ flex: 1 }}>
        <Text style={[selected ? typography.bodyStrong : typography.body, { color: colors.text }]}>
          {label}
        </Text>
        {caption ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{caption}</Text> : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={iconSize.md} color={colors.accent} /> : null}
    </PressableScale>
  );
}
