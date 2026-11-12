import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { LabelColour } from "../theme/tokens";
import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import { LABEL_COLOURS } from "./labelSheets";

const COLUMNS = 4;

/** The eight label colours as equal swatches in four columns. Each says its name, so colour is never the only sign. */
export function ColourSwatches({ value, onChange }: { value: LabelColour; onChange: (next: LabelColour) => void }) {
  const { t } = useTranslation();
  const { colors, labelColors, typography, radius, spacing, layout, iconSize } = useTheme();
  const rows = [LABEL_COLOURS.slice(0, COLUMNS), LABEL_COLOURS.slice(COLUMNS)];
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t("tasks.labels.colourLabel")} style={{ gap: spacing[1] }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap: spacing[1] }}>
          {row.map((colour) => {
            const selected = colour === value;
            const name = t(`tasks.colours.${colour}`);
            return (
              <PressableScale
                key={colour}
                accessibilityRole="radio"
                accessibilityLabel={name}
                accessibilityState={{ selected, checked: selected }}
                onPress={() => onChange(colour)}
                style={{
                  flex: 1,
                  minHeight: layout.controlHeight,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: spacing[0] / 2,
                  borderRadius: radius.field,
                  borderWidth: 2,
                  borderColor: selected ? colors.text : "transparent",
                  backgroundColor: labelColors[colour].bg,
                }}
              >
                {selected ? <Ionicons name="checkmark" size={iconSize.sm} color={labelColors[colour].text} /> : null}
                <Text style={[typography.label, { color: labelColors[colour].text }]} numberOfLines={1}>
                  {name}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      ))}
    </View>
  );
}
