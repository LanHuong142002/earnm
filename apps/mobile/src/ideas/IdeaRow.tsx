import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { LabelChips } from "../tasks/LabelChip";
import { resolveLabels } from "../tasks/labelDisplay";
import type { Label } from "../tasks/types";
import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import { StatusPill } from "./StatusPill";
import { ideaAuthorName } from "./view";
import { VoteColumn } from "./VoteControls";
import type { Idea } from "./types";

/** One idea of the board (mockup 1b): vote column on the left; title, status, labels, counts and author on the right. */
export function IdeaRow({
  idea,
  labels,
  pending,
  divider,
  onOpen,
  onVote,
}: {
  idea: Idea;
  labels: readonly Label[];
  /** A change of this idea waits to be saved ("Chờ lưu"). */
  pending: boolean;
  /** Hairline above the row; set it on every row but the first. */
  divider: boolean;
  onOpen: () => void;
  onVote: (pressed: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, iconSize } = useTheme();
  const author = ideaAuthorName(idea, t("ideas.formerMember"));
  const dropped = idea.status === "dropped";
  const meta = (icon: "chatbubble-outline" | "image-outline", count: number) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] / 2 }}>
      <Ionicons name={icon} size={typography.label.fontSize} color={colors.textSecondary} />
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{count}</Text>
    </View>
  );
  return (
    <View
      style={{
        flexDirection: "row",
        gap: spacing[1] + spacing[0],
        paddingVertical: spacing[1],
        borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderTopColor: colors.border,
        opacity: dropped ? 0.6 : 1,
      }}
    >
      <VoteColumn likeCount={idea.likeCount} dislikeCount={idea.dislikeCount} myVote={idea.myVote} onVote={onVote} />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t("ideas.rowA11y", { title: idea.title, status: t(`ideas.status.${idea.status}`) })}
        onPress={onOpen}
        style={{ flex: 1, gap: spacing[0] + 2, justifyContent: "center", minHeight: iconSize.xl * 2 }}
      >
        <Text style={[typography.bodyStrong, { color: colors.text }]}>{idea.title}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[0] + 2 }}>
          <StatusPill status={idea.status} />
          <LabelChips labels={resolveLabels(idea.labelIds, labels)} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[1] + 2 }}>
          {meta("chatbubble-outline", idea.commentCount)}
          {meta("image-outline", idea.photoCount)}
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{author}</Text>
          {pending ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("ideas.pending")}</Text> : null}
        </View>
      </PressableScale>
    </View>
  );
}
