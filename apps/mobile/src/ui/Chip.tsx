import { Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";

/** A small text label (currency, role). `onHero`: white fill, for use on the hero gradient. */
export function Chip({ label, onHero = false, accessibilityLabel }: { label: string; onHero?: boolean; accessibilityLabel?: string }) {
  const { colors, typography, radius, chip, heroGradient, onFixed } = useTheme();
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingVertical: chip.paddingVertical,
        paddingHorizontal: chip.paddingHorizontal,
        borderRadius: radius.button,
        backgroundColor: onHero ? onFixed : colors.tile,
      }}
    >
      <Text
        accessibilityLabel={accessibilityLabel}
        style={[
          typography.caption,
          // caption is weight 400; chips use 600.
          { fontFamily: typography.label.fontFamily, color: onHero ? heroGradient[0] : colors.accentStrong },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}
