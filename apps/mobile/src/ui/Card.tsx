import type { ReactNode } from "react";
import { View } from "react-native";

import { useTheme } from "../theme/useTheme";

export function Card({ children }: { children: ReactNode }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.card,
        paddingHorizontal: spacing[2],
        paddingVertical: spacing[0],
      }}
    >
      {children}
    </View>
  );
}
