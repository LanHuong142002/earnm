import type { TextStyle } from "react-native";

// Values copied from DESIGN.md (front matter). Change them there first.

export type ColorSet = {
  background: string;
  surface: string;
  field: string;
  tile: string;
  tileBorder: string;
  border: string;
  text: string;
  textSecondary: string;
  placeholder: string;
  accent: string;
  accentStrong: string;
  onAccent: string;
  danger: string;
  dangerBg: string;
  success: string;
};

export const colors: { light: ColorSet; dark: ColorSet } = {
  light: {
    background: "#FFFFFF",
    surface: "#FFFFFF",
    field: "#F3F4F6",
    tile: "#FFF1EB",
    tileBorder: "#FADCCB",
    border: "#EEEEEE",
    text: "#141414",
    textSecondary: "#5F5F5F",
    placeholder: "#6B6B6B",
    accent: "#F4511E",
    accentStrong: "#C2410C",
    onAccent: "#FFFFFF",
    danger: "#B3261E",
    dangerBg: "#FDF0EF",
    success: "#1E7F4F",
  },
  dark: {
    background: "#121212",
    surface: "#1C1C1C",
    field: "#1E1E1E",
    tile: "#2A1A14",
    tileBorder: "#3D261B",
    border: "#2A2A2A",
    text: "#F2F2F2",
    textSecondary: "#A3A3A3",
    placeholder: "#8F8F8F",
    accent: "#F4511E",
    accentStrong: "#F4511E",
    onAccent: "#141414",
    danger: "#F2B8B5",
    dangerBg: "#3A1715",
    success: "#6FCF97",
  },
};

export const fontFamily = {
  regular: "PlusJakartaSans_400Regular",
  semiBold: "PlusJakartaSans_600SemiBold",
  extraBold: "PlusJakartaSans_800ExtraBold",
} as const;

export const typography = {
  screenTitle: { fontFamily: fontFamily.extraBold, fontSize: 24, lineHeight: 30 },
  sectionTitle: { fontFamily: fontFamily.extraBold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: fontFamily.semiBold, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: fontFamily.semiBold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 16 },
  overline: {
    fontFamily: fontFamily.extraBold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
} satisfies Record<string, TextStyle>;

export const spacing = [4, 8, 12, 16, 20, 24, 32] as const;

export const layout = { screenPadding: 20, sectionGap: 24, controlHeight: 44 } as const;

export const tile = { width: 52, height: 48 } as const;

export const iconSize = { sm: 20, md: 22, lg: 24, xl: 30 } as const;

export const projectCard = { coverHeight: 92 } as const;

export const radius = { pill: 999, field: 12, button: 12, tile: 14, card: 16, checkbox: 6 } as const;

export const motion = {
  enter: { duration: 300, translateY: 8, stagger: 40, easing: [0.2, 0.8, 0.2, 1] },
  press: { duration: 120, scale: 0.97 },
  shake: { duration: 300, distance: 4 },
  progress: { duration: 250 },
} as const;

// White for text on the Home banner (both modes).
export const onFixed = "#FFFFFF";

export const disabled = { opacity: 0.5 } as const;

export const header = { backInset: 4 } as const;

