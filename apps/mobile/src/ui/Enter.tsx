import type { ReactNode } from "react";
import { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { motion } from "../theme/tokens";

const [x1, y1, x2, y2] = motion.enter.easing;

// Fade in and rise 8px, staggered by `index`. Reduce Motion: fade only.
export function Enter({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      index * motion.enter.stagger,
      withTiming(1, { duration: motion.enter.duration, easing: Easing.bezier(x1, y1, x2, y2) }),
    );
  }, [index, progress]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduced ? 0 : (1 - progress.value) * motion.enter.translateY }],
  }));

  return <Animated.View style={[animated, style]}>{children}</Animated.View>;
}
