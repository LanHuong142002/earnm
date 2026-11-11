import { useColorScheme } from "react-native";

import {
  chip,
  colors,
  disabled,
  header,
  heroGradient,
  iconSize,
  identity,
  layout,
  motion,
  onFixed,
  projectColors,
  radius,
  spacing,
  tile,
  typography,
  type ColorSet,
} from "./tokens";

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
  disabled: typeof disabled;
  header: typeof header;
  identity: typeof identity;
  chip: typeof chip;
  heroGradient: typeof heroGradient;
  projectColors: typeof projectColors;
  onFixed: typeof onFixed;
};

export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return {
    scheme,
    colors: colors[scheme],
    typography,
    spacing,
    layout,
    radius,
    tile,
    iconSize,
    motion,
    disabled,
    header,
    identity,
    chip,
    heroGradient,
    projectColors,
    onFixed,
  };
}
