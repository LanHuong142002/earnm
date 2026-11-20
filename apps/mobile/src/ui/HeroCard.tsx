import { Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";

/** The one orange card of a screen (DESIGN.md hero card): the key number big, a quiet line under it and, optionally, two figures below a rule. */
export function HeroCard({
  label,
  value,
  sub,
  cells,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  sub: string;
  cells?: readonly { label: string; value: string }[];
  accessibilityLabel: string;
}) {
  const { typography, radius, spacing, colors, onFixed } = useTheme();
  const text = { color: onFixed };
  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={{ gap: spacing[0], padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.accentStrong }}>
      <Text style={[typography.label, text]}>{label}</Text>
      <Text style={[typography.screenTitle, text]}>{value}</Text>
      <Text style={[typography.caption, text]}>{sub}</Text>
      {cells && cells.length > 0 ? (
        <View style={{ flexDirection: "row", gap: spacing[2], marginTop: spacing[0], paddingTop: spacing[1], borderTopWidth: 1, borderTopColor: onFixed + "40" }}>
          {cells.map((cell) => (
            <View key={cell.label} style={{ flex: 1 }}>
              <Text style={[typography.caption, text]}>{cell.label}</Text>
              <Text style={[typography.bodyStrong, text]}>{cell.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
