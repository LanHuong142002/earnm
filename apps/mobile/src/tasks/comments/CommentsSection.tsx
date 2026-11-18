import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActionSheetIOS, Alert, Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import { useTheme } from "../../theme/useTheme";
import { ErrorText } from "../../ui/ErrorText";
import { PressableScale } from "../../ui/PressableScale";
import type { DueLanguage } from "../dueDate";
import type { Task } from "../types";
import { CommentBubble } from "./CommentBubble";
import { CommentComposer } from "./CommentComposer";
import { formatCommentTime } from "./commentTime";
import type { CommentOrder } from "./types";
import { useTaskComments, type CommentResult } from "./useTaskComments";

/** The sort choice: an action sheet on iOS, Alert buttons elsewhere (like the checklist menu). */
function showSortMenu(t: (key: string) => string, current: CommentOrder, onPick: (order: CommentOrder) => void): void {
  const names: Record<CommentOrder, string> = { newest: t("tasks.comments.newest"), oldest: t("tasks.comments.oldest") };
  const label = (o: CommentOrder) => (o === current ? `✓ ${names[o]}` : names[o]);
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: t("tasks.comments.sortTitle"), options: [label("newest"), label("oldest"), t("tasks.comments.cancel")], cancelButtonIndex: 2 },
      (index) => {
        if (index === 0) onPick("newest");
        else if (index === 1) onPick("oldest");
      },
    );
    return;
  }
  Alert.alert(
    t("tasks.comments.sortTitle"),
    undefined,
    [
      { text: label("newest"), onPress: () => onPick("newest") },
      { text: label("oldest"), onPress: () => onPick("oldest") },
      { text: t("tasks.comments.cancel"), style: "cancel" },
    ],
    { cancelable: true },
  );
}

/** "Bình luận" on the task screen: write field, then the comments five at a time (spec R17-R26). */
export function CommentsSection({
  projectId,
  taskId,
  task,
}: {
  projectId: string;
  taskId: string;
  task: Pick<Task, "createdById" | "assignees">;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, layout, radius, spacing, iconSize } = useTheme();
  const { identity } = useAuth();
  const c = useTaskComments({ projectId, taskId, me: identity, task });
  // Times are judged against the moment the section opened.
  const [now] = useState(() => new Date());
  const [problem, setProblem] = useState<string | null>(null);
  const lang: DueLanguage = i18n.language === "vi" ? "vi" : "en";

  const settle = async (promise: Promise<CommentResult>): Promise<boolean> => {
    const result = await promise;
    setProblem(result.ok ? null : t(result.reason === "not_allowed" ? "tasks.comments.notAllowed" : "tasks.comments.notReady"));
    return result.ok;
  };

  const empty = !c.loading && !c.unavailable && c.count === 0;

  return (
    <View style={{ gap: spacing[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1], minHeight: layout.controlHeight }}>
        <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text }]}>
          {t("tasks.comments.heading")}
        </Text>
        <Text style={[typography.label, { flex: 1, color: colors.textSecondary }]}>{c.count > 0 ? String(c.count) : ""}</Text>
        {c.count > 0 ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("tasks.comments.sortA11y", { order: t(`tasks.comments.${c.order}`) })}
            onPress={() => showSortMenu(t, c.order, c.setOrder)}
            style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] / 2, minHeight: layout.controlHeight, justifyContent: "center" }}
          >
            <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t(`tasks.comments.${c.order}`)}</Text>
            <Ionicons name="chevron-down" size={iconSize.sm} color={colors.accentStrong} />
          </PressableScale>
        ) : null}
      </View>

      <CommentComposer involved={c.involved} onSend={(text, remind) => c.add(text, remind)} />
      {problem ? <ErrorText message={problem} /> : null}

      {c.loading ? (
        <View accessible accessibilityLabel={t("tasks.comments.loadingA11y")} style={{ gap: spacing[3] }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              importantForAccessibility="no-hide-descendants"
              style={{ height: layout.controlHeight * 1.5, width: i === 1 ? "80%" : "100%", borderRadius: radius.card, backgroundColor: colors.field }}
            />
          ))}
        </View>
      ) : null}
      {c.unavailable ? <Text style={[typography.label, { color: colors.textSecondary }]}>{t("tasks.comments.offline")}</Text> : null}
      {empty ? <Text style={[typography.body, { color: colors.textSecondary }]}>{t("tasks.comments.emptyBody")}</Text> : null}

      {c.page.items.length > 0 ? (
        <View style={{ gap: spacing[3] }}>
          {c.page.items.map((comment) => (
            <CommentBubble
              key={comment.id}
              comment={comment}
              time={formatCommentTime(comment.createdAt, now, lang, t)}
              canEdit={c.canEdit(comment)}
              bell={c.bell(comment)}
              onSave={(text) => settle(c.edit(comment.id, text))}
              onDelete={() => void settle(c.remove(comment.id))}
              onToggleRemind={() => void settle(c.toggleRemind(comment.id))}
              onRetry={() => void c.retry(comment.id)}
              onDiscard={() => void c.discard(comment.id)}
            />
          ))}
        </View>
      ) : null}

      {c.page.remaining > 0 ? (
        <PressableScale
          accessibilityRole="button"
          onPress={c.loadMore}
          style={{ minHeight: layout.controlHeight, justifyContent: "center", alignSelf: "flex-start" }}
        >
          <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>
            {t("tasks.comments.loadMore", { count: c.page.remaining })}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}
