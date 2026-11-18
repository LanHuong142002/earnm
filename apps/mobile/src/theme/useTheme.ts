import { useColorScheme } from "react-native";

import {
  avatar,
  colors,
  disabled,
  header,
  iconSize,
  labelColors,
  layout,
  motion,
  onFixed,
  projectCard,
  radius,
  spacing,
  tile,
  typography,
  viewer,
  type ColorSet,
  type LabelColour,
  type LabelColourPair,
} from "./tokens";

export type Theme = {
  scheme: "light" | "dark";
  colors: ColorSet;
  labelColors: Record<LabelColour, LabelColourPair>;
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
  viewer: typeof viewer;
  projectCard: typeof projectCard;
  avatar: typeof avatar;
};

export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return {
    scheme,
    colors: colors[scheme],
    labelColors: labelColors[scheme],
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
    viewer,
    projectCard,
    avatar,
  };
}
