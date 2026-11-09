import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { Text } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { motion } from "../theme/tokens";
import { useTheme } from "../theme/useTheme";

// Alert icon + message. Fades in and shakes on mount; Reduce Motion: fade only.
export function ErrorText({ message }: { message: string }) {
  const { colors, typography, spacing, iconSize } = useTheme();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0);
  const shift = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: motion.shake.duration });
    if (reduced) return;
    const d = motion.shake.distance;
    const step = motion.shake.duration / 4;
    shift.value = withSequence(
      withTiming(-d, { duration: step }),
      withTiming(d, { duration: step }),
      withTiming(-d, { duration: step }),
      withTiming(0, { duration: step }),
    );
  }, [opacity, shift, reduced]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: shift.value }],
  }));

  return (
    <Animated.View
      accessibilityRole="alert"
      style={[{ flexDirection: "row", alignItems: "flex-start", gap: spacing[1] }, animated]}
    >
      <Ionicons name="alert-circle-outline" size={iconSize.sm} color={colors.danger} />
      <Text style={[typography.label, { flex: 1, color: colors.danger }]}>{message}</Text>
    </Animated.View>
  );
}
