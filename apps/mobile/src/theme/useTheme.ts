import { useColorScheme } from "react-native";

import { colors, iconSize, layout, motion, radius, spacing, tile, typography, type ColorSet } from "./tokens";

export type Theme = {
  scheme: "light" | "dark";
  colors: ColorSet;
  typography: typeof typography;
  spacing: typeof spacing;
  layout: typeof layout;
  radius: typeof radius;
  tile: typeof tile;
  iconSize: typeof iconSize;
  motion: typeof motion;
};

export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { scheme, colors: colors[scheme], typography, spacing, layout, radius, tile, iconSize, motion };
}
