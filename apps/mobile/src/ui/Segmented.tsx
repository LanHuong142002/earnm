import { Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "./PressableScale";

export type SegmentedOption<T extends string> = { value: T; label: string };

/**
 * A row of exclusive choices on a `field` track; the chosen one is a `surface` pill with a border. The chosen one
 * is also bolder and announced as selected, so colour is never the only sign. Each segment is `controlHeight` high.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  compact = false,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  /** Hugs its labels instead of filling the width (for a unit switch next to a field). */
  compact?: boolean;
}) {
  const { colors, typography, layout, radius, spacing } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: "row",
        alignSelf: compact ? "flex-start" : "stretch",
        padding: spacing[0] / 2,
        gap: spacing[0] / 2,
        borderRadius: radius.field,
        backgroundColor: colors.field,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            // The track's padding adds the last 4pt, so the touch area is a full control height.
            hitSlop={spacing[0] / 2}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            style={{
              flex: compact ? undefined : 1,
              minHeight: layout.controlHeight - spacing[0],
              minWidth: layout.controlHeight,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: spacing[1],
              borderRadius: radius.field - spacing[0] / 2,
              borderWidth: 1,
              borderColor: selected ? colors.border : "transparent",
              backgroundColor: selected ? colors.surface : "transparent",
            }}
          >
            <Text
              style={[
                selected ? typography.bodyStrong : typography.body,
                { color: selected ? colors.text : colors.textSecondary, textAlign: "center" },
              ]}
            >
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
