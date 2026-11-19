import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import { SIZE_NAMES, type SizeName } from "./types";

/**
 * S, M and L as round pills (mockup 2g): each a full circle one control height wide. Chosen ones have the tile
 * colour, a thicker accent border and bold text, and are announced as checked. At least one stays chosen (the caller decides).
 */
export function SizePills({ value, onToggle }: { value: readonly SizeName[]; onToggle: (size: SizeName) => void }) {
  const { t } = useTranslation();
  const { colors, typography, layout, radius, spacing } = useTheme();
  return (
    <View accessibilityRole="group" accessibilityLabel={t("products.sizeGroupA11y")} style={{ flexDirection: "row", gap: spacing[1] }}>
      {SIZE_NAMES.map((size) => {
        const chosen = value.includes(size);
        return (
          <PressableScale
            key={size}
            accessibilityRole="checkbox"
            accessibilityLabel={t("products.sizeA11y", { size })}
            accessibilityState={{ checked: chosen }}
            onPress={() => onToggle(size)}
            style={{
              width: layout.controlHeight,
              height: layout.controlHeight,
              borderRadius: radius.pill,
              borderWidth: 1.5,
              borderColor: chosen ? colors.accent : colors.field,
              backgroundColor: chosen ? colors.tile : colors.field,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={[chosen ? typography.bodyStrong : typography.body, { color: chosen ? colors.accentStrong : colors.text }]}>{size}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
