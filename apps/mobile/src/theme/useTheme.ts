import { useColorScheme } from "react-native";

import {
  avatar,
  colors,
  disabled,
  header,
  iconSize,
  layout,
  motion,
  onFixed,
  projectCard,
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
  onFixed: typeof onFixed;
  projectCard: typeof projectCard;
  avatar: typeof avatar;
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
    onFixed,
    projectCard,
    avatar,
  };
}
