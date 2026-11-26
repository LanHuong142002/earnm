import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import { votePressedState, voteLabels } from "./screenView";
import type { Vote } from "./types";

type VoteProps = { likeCount: number; dislikeCount: number; myVote: Vote; onVote: (pressed: 1 | -1) => void };

/** "Thích, 3 người. bạn đã thích" and the like: each button's own count and the viewer's vote, for the screen reader. */
function useVoteLabels(likeCount: number, dislikeCount: number, myVote: Vote) {
  const { t } = useTranslation();
  const labels = voteLabels(likeCount, dislikeCount, myVote);
  const say = ({ key, params }: { key: string; params: { count: number; mine: string } }) =>
    t(key, { count: params.count, mine: t(params.mine) });
  return { up: say(labels.like), down: say(labels.dislike) };
}

const iconName = (direction: "up" | "down", on: boolean) =>
  direction === "up" ? (on ? "thumbs-up" : "thumbs-up-outline") : on ? "thumbs-down" : "thumbs-down-outline";

/** Thumbs-up over thumbs-down at the left of an idea row, each with its own count beside the icon (mockup 1). */
export function VoteColumn({ likeCount, dislikeCount, myVote, onVote }: VoteProps) {
  const { colors, typography, layout, iconSize, spacing } = useTheme();
  const pressed = votePressedState(myVote);
  const labels = useVoteLabels(likeCount, dislikeCount, myVote);
  const button = (direction: "up" | "down") => {
    const on = pressed[direction];
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={labels[direction]}
        accessibilityState={{ selected: on }}
        hitSlop={{ top: 4, bottom: 4 }}
        onPress={() => onVote(direction === "up" ? 1 : -1)}
        style={{
          minHeight: layout.controlHeight - 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: spacing[0] + 2,
        }}
      >
        <Ionicons name={iconName(direction, on)} size={iconSize.md} color={on ? colors.accentStrong : colors.textSecondary} />
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[typography.bodyStrong, { color: on ? colors.accentStrong : colors.textSecondary }]}
        >
          {direction === "up" ? likeCount : dislikeCount}
        </Text>
      </PressableScale>
    );
  };
  return (
    <View style={{ minWidth: layout.controlHeight + spacing[2], justifyContent: "center" }}>
      {button("up")}
      {button("down")}
    </View>
  );
}

/** The two equal-width like / dislike buttons of the idea screen, icon and count side by side (mockup 2). Pressed one has the accent border and tint. */
export function BigVote({ likeCount, dislikeCount, myVote, onVote }: VoteProps) {
  const { colors, typography, layout, radius, spacing, iconSize } = useTheme();
  const pressed = votePressedState(myVote);
  const labels = useVoteLabels(likeCount, dislikeCount, myVote);
  const button = (direction: "up" | "down") => {
    const on = pressed[direction];
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={labels[direction]}
        accessibilityState={{ selected: on }}
        onPress={() => onVote(direction === "up" ? 1 : -1)}
        style={{
          flex: 1,
          minHeight: layout.controlHeight,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing[0] + 2,
          paddingHorizontal: spacing[2],
          borderRadius: radius.button,
          borderWidth: 1.5,
          borderColor: on ? colors.accent : colors.field,
          backgroundColor: on ? colors.tile : colors.field,
        }}
      >
        <Ionicons name={iconName(direction, on)} size={iconSize.lg} color={on ? colors.accentStrong : colors.text} />
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[typography.bodyStrong, { color: on ? colors.accentStrong : colors.text }]}
        >
          {direction === "up" ? likeCount : dislikeCount}
        </Text>
      </PressableScale>
    );
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1] }}>
      {button("up")}
      {button("down")}
    </View>
  );
}
