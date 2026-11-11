import type { ReactNode } from "react";
import { View } from "react-native";

import { useTheme } from "../theme/useTheme";

/** `flush`: no inner padding, for a card that lays out its own edges (a cover on top). */
export function Card({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.card,
        padding: flush ? 0 : spacing[2],
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}
