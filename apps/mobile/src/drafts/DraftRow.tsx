import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import type { DraftStatus } from "./types";

/** Done in the success colour, In progress quiet. The word is always there, so colour is never the only sign. */
export function StatusPill({ status }: { status: DraftStatus }) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const done = status === "done";
  return (
    <View style={{ paddingVertical: spacing[0] / 2, paddingHorizontal: spacing[0] + 2, borderRadius: radius.pill, backgroundColor: done ? colors.tile : colors.field }}>
      <Text style={[typography.caption, { color: done ? colors.success : colors.textSecondary }]}>{t(done ? "drafts.statusDone" : "drafts.statusWorking")}</Text>
    </View>
  );
}

/** One draft of the list (mockup A2): name, then its status pill, sizes and what it costs or lacks. */
export function DraftRowView({
  name,
  status,
  summary,
  pending,
  divider,
  onOpen,
}: {
  name: string;
  status: DraftStatus;
  /** Sizes with the cost, the missing prices or "no recipe yet". */
  summary: string;
  pending: boolean;
  divider: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, spacing, iconSize } = useTheme();
  const statusText = t(status === "done" ? "drafts.statusDone" : "drafts.statusWorking");
  const label = [t("drafts.rowA11y", { name, status: statusText, summary }), pending ? t("drafts.pending") : null].filter(Boolean).join(", ");
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onOpen}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing[1],
        minHeight: layout.controlHeight + spacing[3],
        paddingVertical: spacing[1],
        borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderTopColor: colors.border,
      }}
    >
      <View style={{ flex: 1, gap: spacing[0] / 2 }}>
        <Text style={[typography.bodyStrong, { color: colors.text }]} numberOfLines={2}>
          {name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing[0] }}>
          <StatusPill status={status} />
          <Text style={[typography.caption, { color: colors.textSecondary, flexShrink: 1 }]}>
            {summary}
            {pending ? ` · ${t("drafts.pending")}` : ""}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} />
    </PressableScale>
  );
}
