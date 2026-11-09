import { Ionicons } from "@expo/vector-icons";
import { Text } from "react-native";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "./PressableScale";

// A radio row inside a Card. The selected row shows a check icon, never colour alone.
export function ChoiceRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, typography, layout } = useTheme();
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
      }}
    >
      <Text style={[selected ? typography.bodyStrong : typography.body, { color: colors.text }]}>
        {label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={22} color={colors.accent} /> : null}
    </PressableScale>
  );
}
