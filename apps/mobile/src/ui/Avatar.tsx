import { Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";

export const AVATAR_SIZE = 34;
export const AVATAR_RING = 2;

/** Round, single-tone avatar: `field` fill, one letter, a ring in the `background` token. */
export function Avatar({ letter, muted = false }: { letter: string; muted?: boolean }) {
  const { colors, typography } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
        backgroundColor: colors.field,
        borderWidth: AVATAR_RING,
        borderColor: colors.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        allowFontScaling={false}
        style={[typography.label, { color: muted ? colors.textSecondary : colors.text }]}
      >
        {letter}
      </Text>
    </View>
  );
}
