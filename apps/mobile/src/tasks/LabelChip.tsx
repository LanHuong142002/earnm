import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import type { Label } from "./types";
import { splitChips } from "./labelDisplay";

/** A label's name on its tint. The name is always shown, so colour is never the only sign. */
export function LabelChip({ label, size = "sm" }: { label: Pick<Label, "name" | "colour">; size?: "sm" | "md" }) {
  const { labelColors, typography, radius, spacing } = useTheme();
  const pair = labelColors[label.colour];
  const small = size === "sm";
  return (
    <View
      style={{
        backgroundColor: pair.bg,
        borderRadius: radius.pill,
        paddingVertical: small ? spacing[0] / 2 : spacing[0],
        paddingHorizontal: small ? spacing[1] + 1 : spacing[1] + 3,
        maxWidth: "100%",
        flexShrink: 1,
      }}
    >
      <Text
        style={[small ? typography.caption : typography.label, { color: pair.text, fontFamily: typography.label.fontFamily }]}
        numberOfLines={1}
      >
        {label.name}
      </Text>
    </View>
  );
}

/** Up to 3 chips, then a "+n" chip. */
export function LabelChips({ labels }: { labels: readonly Label[] }) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const { shown, extra } = splitChips(labels);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[0], flexShrink: 1 }}>
      {shown.map((label) => (
        <LabelChip key={label.id} label={label} />
      ))}
      {extra > 0 ? (
        <View
          style={{
            backgroundColor: colors.field,
            borderRadius: radius.pill,
            paddingVertical: spacing[0] / 2,
            paddingHorizontal: spacing[1] + 1,
          }}
        >
          <Text style={[typography.caption, { color: colors.textSecondary, fontFamily: typography.label.fontFamily }]}>
            {t("tasks.moreAssignees", { count: extra })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
