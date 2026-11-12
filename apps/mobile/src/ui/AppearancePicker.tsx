import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Appearance, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { asyncStorageStore } from "../sync/asyncStorageStore";
import {
  readAppearance,
  schemeOverride,
  writeAppearance,
  type AppearanceChoice,
} from "../theme/appearance";
import { motion } from "../theme/tokens";
import { useTheme } from "../theme/useTheme";
import { PressableScale } from "./PressableScale";

type IconName = "phone-portrait-outline" | "sunny-outline" | "moon-outline";

const OPTIONS: { choice: AppearanceChoice; icon: IconName }[] = [
  { choice: "system", icon: "phone-portrait-outline" },
  { choice: "light", icon: "sunny-outline" },
  { choice: "dark", icon: "moon-outline" },
];

const TILE_HEIGHT = 84;
const SELECTED_SCALE = 1.12;

function Tile({
  choice,
  icon,
  selected,
  onPress,
}: {
  choice: AppearanceChoice;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius, iconSize, layout } = useTheme();
  const reduced = useReducedMotion();
  const progress = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    progress.set(withTiming(selected ? 1 : 0, { duration: motion.progress.duration }));
  }, [selected, progress]);

  const iconStyle = useAnimatedStyle(() => {
    if (reduced) return {};
    const p = progress.get();
    const scale = 1 + (SELECTED_SCALE - 1) * p;
    if (choice === "light") return { transform: [{ rotate: `${90 * p}deg` }, { scale }] };
    if (choice === "dark") return { transform: [{ rotate: `${-20 * p}deg` }, { scale }] };
    return { transform: [{ translateY: -2 * p }, { scale }] };
  });

  const label = t(`settings.appearance.${choice}`);
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      style={{
        flex: 1,
        height: TILE_HEIGHT,
        minHeight: layout.controlHeight,
        borderRadius: radius.tile,
        borderWidth: selected ? 1 : 0,
        borderColor: colors.tileBorder,
        backgroundColor: selected ? colors.tile : colors.field,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing[1],
      }}
    >
      <Animated.View style={iconStyle}>
        <Ionicons name={icon} size={iconSize.lg} color={selected ? colors.accent : colors.textSecondary} />
      </Animated.View>
      <Text style={[typography.label, { color: selected ? colors.text : colors.textSecondary }]}>
        {label}
      </Text>
      {selected ? (
        <View style={{ position: "absolute", top: spacing[1], right: spacing[1] }}>
          <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />
        </View>
      ) : null}
    </PressableScale>
  );
}

/**
 * Three tiles: System, Light, Dark. Saves the choice and applies it. `contentOpacity`, when given,
 * is faded out and back in around the scheme change (the fade stays under Reduce Motion).
 */
export function AppearancePicker({ contentOpacity }: { contentOpacity?: SharedValue<number> }) {
  const { spacing } = useTheme();
  const [choice, setChoice] = useState<AppearanceChoice>("system");

  useEffect(() => {
    let alive = true;
    void readAppearance(asyncStorageStore).then((saved) => {
      if (alive) setChoice(saved);
    });
    return () => {
      alive = false;
    };
  }, []);

  function select(next: AppearanceChoice) {
    if (next === choice) return;
    setChoice(next);
    void writeAppearance(asyncStorageStore, next).catch(() => undefined);
    const apply = () => Appearance.setColorScheme(schemeOverride(next));
    if (!contentOpacity) {
      apply();
      return;
    }
    const half = motion.enter.duration / 2;
    contentOpacity.set(withTiming(0, { duration: half }));
    setTimeout(() => {
      apply();
      contentOpacity.set(withTiming(1, { duration: half }));
    }, half);
  }

  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: spacing[2] }}>
      {OPTIONS.map((o) => (
        <Tile
          key={o.choice}
          choice={o.choice}
          icon={o.icon}
          selected={o.choice === choice}
          onPress={() => select(o.choice)}
        />
      ))}
    </View>
  );
}

export function useContentFade() {
  const opacity = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return { opacity, style };
}
