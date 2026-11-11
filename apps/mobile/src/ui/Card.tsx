import type { ReactNode } from "react";
import { View } from "react-native";

import { useTheme } from "../theme/useTheme";

/** `stripeColor`: a stripe down the left edge (project identity). */
export function Card({ children, stripeColor }: { children: ReactNode; stripeColor?: string }) {
  const { colors, radius, spacing, identity } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.card,
        paddingHorizontal: spacing[2],
        paddingVertical: spacing[2],
        overflow: "hidden",
      }}
    >
      {stripeColor ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: identity.stripeWidth,
            backgroundColor: stripeColor,
          }}
        />
      ) : null}
      {children}
    </View>
  );
}
