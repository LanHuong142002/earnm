import { View } from "react-native";

import { LabelChip } from "../tasks/LabelChip";
import type { Label } from "../tasks/types";
import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";

/**
 * A label that can be chosen: its chip, with the accent ring when chosen. Chosen is shown by the ring alone,
 * no tick mark (spec R21); the name is always written and the state is announced.
 */
export function LabelToggle({ label, selected, onPress }: { label: Label; selected: boolean; onPress: () => void }) {
  const { colors, layout, radius, spacing } = useTheme();
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={label.name}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{ minHeight: layout.controlHeight, justifyContent: "center", maxWidth: "100%" }}
    >
      <View
        style={{
          padding: spacing[0] / 2,
          borderRadius: radius.pill,
          borderWidth: 1.5,
          borderColor: selected ? colors.accent : "transparent",
        }}
      >
        <LabelChip label={label} size="md" />
      </View>
    </PressableScale>
  );
}
