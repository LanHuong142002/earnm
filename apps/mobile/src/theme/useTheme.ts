import { useColorScheme } from "react-native";

import { colors, layout, motion, radius, spacing, typography, type ColorSet } from "./tokens";

export type Theme = {
  scheme: "light" | "dark";
  colors: ColorSet;
  typography: typeof typography;
  spacing: typeof spacing;
  layout: typeof layout;
  radius: typeof radius;
  motion: typeof motion;
};

export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { scheme, colors: colors[scheme], typography, spacing, layout, radius, motion };
}
