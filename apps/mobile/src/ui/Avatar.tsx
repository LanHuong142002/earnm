import { Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";

/** Round, single-tone avatar: `field` fill, one letter, a ring in the `background` token. */
export function Avatar({ letter, muted = false }: { letter: string; muted?: boolean }) {
  const { colors, typography, avatar } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: avatar.size,
        height: avatar.size,
        borderRadius: avatar.size / 2,
        backgroundColor: colors.field,
        borderWidth: avatar.ring,
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
