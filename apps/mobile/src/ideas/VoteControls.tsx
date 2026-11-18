import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import { voteChoice, votePressedState } from "./screenView";
import type { Vote } from "./types";

/** "Ủng hộ. Điểm 3, bạn đã ủng hộ" and the like: the score and the viewer's own vote, for the screen reader. */
function useVoteLabels(score: number, myVote: Vote) {
  const { t } = useTranslation();
  const mine = t(`ideas.voteMine.${voteChoice(myVote)}`);
  return {
    up: t("ideas.voteUpA11y", { score, mine }),
    down: t("ideas.voteDownA11y", { score, mine }),
  };
}

/** ▲ score ▼ at the left of an idea row (mockup 1b). The viewer's own vote is highlighted and announced as selected. */
export function VoteColumn({ score, myVote, onVote }: { score: number; myVote: Vote; onVote: (pressed: 1 | -1) => void }) {
  const { colors, typography, layout, iconSize } = useTheme();
  const pressed = votePressedState(myVote);
  const labels = useVoteLabels(score, myVote);
  const arrow = (direction: "up" | "down") => {
    const on = pressed[direction];
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={labels[direction]}
        accessibilityState={{ selected: on }}
        hitSlop={{ top: 4, bottom: 4 }}
        onPress={() => onVote(direction === "up" ? 1 : -1)}
        style={{ width: layout.controlHeight, height: layout.controlHeight - 10, alignItems: "center", justifyContent: "center" }}
      >
        <Ionicons
          name={direction === "up" ? "arrow-up" : "arrow-down"}
          size={iconSize.lg}
          color={on ? colors.accentStrong : colors.textSecondary}
        />
      </PressableScale>
    );
  };
  return (
    <View style={{ width: layout.controlHeight, alignItems: "center" }}>
      {arrow("up")}
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[typography.bodyStrong, { color: myVote !== 0 ? colors.accentStrong : colors.text }]}
      >
        {score < 0 ? `−${Math.abs(score)}` : String(score)}
      </Text>
      {arrow("down")}
    </View>
  );
}

/** The big "Ủng hộ" / score / "Không" row of the idea screen (mockup 2a). Pressed one has the accent border and tint. */
export function BigVote({ score, myVote, onVote }: { score: number; myVote: Vote; onVote: (pressed: 1 | -1) => void }) {
  const { t } = useTranslation();
  const { colors, typography, layout, radius, spacing, iconSize } = useTheme();
  const pressed = votePressedState(myVote);
  const labels = useVoteLabels(score, myVote);
  const button = (direction: "up" | "down") => {
    const on = pressed[direction];
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={labels[direction]}
        accessibilityState={{ selected: on }}
        onPress={() => onVote(direction === "up" ? 1 : -1)}
        style={{
          minHeight: layout.controlHeight,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[0] + 2,
          paddingHorizontal: spacing[2],
          borderRadius: radius.button,
          borderWidth: 1.5,
          borderColor: on ? colors.accent : colors.field,
          backgroundColor: on ? colors.tile : colors.field,
        }}
      >
        <Ionicons
          name={direction === "up" ? "arrow-up" : "arrow-down"}
          size={iconSize.lg}
          color={on ? colors.accentStrong : colors.text}
        />
        <Text style={[typography.bodyStrong, { color: on ? colors.accentStrong : colors.text }]}>
          {t(direction === "up" ? "ideas.voteUp" : "ideas.voteDown")}
        </Text>
      </PressableScale>
    );
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1] }}>
      {button("up")}
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[typography.sectionTitle, { color: colors.text, minWidth: layout.controlHeight - spacing[1], textAlign: "center" }]}
      >
        {score < 0 ? `−${Math.abs(score)}` : String(score)}
      </Text>
      {button("down")}
    </View>
  );
}
