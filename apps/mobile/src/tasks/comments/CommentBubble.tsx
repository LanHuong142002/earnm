import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/useTheme";
import { Avatar } from "../../ui/Avatar";
import { ErrorText } from "../../ui/ErrorText";
import { PressableScale } from "../../ui/PressableScale";
import { CommentBell } from "./CommentBell";
import type { Comment } from "./types";
import { COMMENT_MAX, authorInitial, authorName, lengthCheck, type BellState } from "./view";

type Props = {
  comment: Comment;
  /** Already formatted ("8:30", "Hôm qua 20:14", ...). */
  time: string;
  canEdit: boolean;
  bell: BellState;
  /** Resolves true once the new text was accepted, which closes the edit. */
  onSave: (text: string) => Promise<boolean>;
  onDelete: () => void;
  onToggleRemind: () => void;
  onRetry: () => void;
  onDiscard: () => void;
};

/** A text action on the meta line, with a 44pt target. */
function Action({ label, a11y, onPress, color, disabled = false }: { label: string; a11y: string; onPress: () => void; color: string; disabled?: boolean }) {
  const { typography, layout, disabled: disabledStyle } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: layout.controlHeight,
        minWidth: layout.controlHeight,
        justifyContent: "center",
        alignItems: "center",
        opacity: disabled ? disabledStyle.opacity : 1,
      }}
    >
      <Text style={[typography.label, { color }]}>{label}</Text>
    </PressableScale>
  );
}

/** One comment: avatar, bubble with name and text, a meta line, and the bell on the right. */
export function CommentBubble({ comment, time, canEdit, bell, onSave, onDelete, onToggleRemind, onRetry, onDiscard }: Props) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const saving = useRef(false);
  const former = t("tasks.comments.formerMember");
  const name = authorName(comment, former);
  const failed = comment.state === "failed";
  const check = lengthCheck(draft);

  const save = async () => {
    if (saving.current || !check.canSend) return;
    saving.current = true;
    try {
      if (await onSave(draft)) setEditing(false);
    } finally {
      saving.current = false;
    }
  };

  const confirmDelete = () =>
    Alert.alert(
      t("tasks.comments.deleteTitle"),
      t("tasks.comments.deleteMessage"),
      [
        { text: t("tasks.comments.cancel"), style: "cancel" },
        { text: t("tasks.comments.delete"), style: "destructive", onPress: onDelete },
      ],
      { cancelable: true },
    );

  const dot = <Text style={[typography.label, { color: colors.textSecondary }]}>·</Text>;
  const metaRow = { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing[0] } as const;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing[1] }}>
      <Avatar letter={authorInitial(comment, former)} muted={comment.author === null} />
      <View style={{ flex: 1 }}>
        <View
          accessible={!editing}
          accessibilityLabel={editing ? undefined : t("tasks.comments.bubbleA11y", { name, time, text: comment.text })}
          style={{
            gap: spacing[0] / 2,
            paddingVertical: spacing[1],
            paddingHorizontal: spacing[2],
            borderRadius: radius.card,
            backgroundColor: failed ? colors.dangerBg : colors.field,
            borderWidth: editing ? 1.5 : 0,
            borderColor: colors.accent,
          }}
        >
          <Text style={[typography.label, { color: colors.text }]}>{name}</Text>
          {editing ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              accessibilityLabel={t("tasks.comments.editField")}
              placeholderTextColor={colors.placeholder}
              style={[typography.body, { color: colors.text, paddingVertical: 0 }]}
            />
          ) : (
            <Text style={[typography.body, { color: colors.text }]}>{comment.text}</Text>
          )}
        </View>
        {editing ? (
          <>
            {check.over > 0 ? (
              <ErrorText message={t("tasks.comments.tooLong", { max: COMMENT_MAX, length: check.length, over: check.over })} />
            ) : null}
            <View style={metaRow}>
              <Action
                label={t("tasks.comments.cancel")}
                a11y={t("tasks.comments.cancel")}
                onPress={() => {
                  setDraft(comment.text);
                  setEditing(false);
                }}
                color={colors.textSecondary}
              />
              {dot}
              <Action label={t("tasks.comments.save")} a11y={t("tasks.comments.save")} onPress={() => void save()} color={colors.accentStrong} disabled={!check.canSend} />
            </View>
          </>
        ) : (
          <View style={metaRow}>
            {comment.state === "waiting" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] / 2 }}>
                <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
                <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("tasks.comments.waiting")}</Text>
              </View>
            ) : failed ? (
              <Text style={[typography.label, { color: colors.danger }]}>{t("tasks.comments.failed")}</Text>
            ) : (
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                {comment.edited ? `${time} · ${t("tasks.comments.edited")}` : time}
              </Text>
            )}
            {failed ? (
              <>
                {dot}
                <Action label={t("tasks.comments.retry")} a11y={t("tasks.comments.retryA11y", { name })} onPress={onRetry} color={colors.accentStrong} />
                {dot}
                <Action label={t("tasks.comments.discard")} a11y={t("tasks.comments.discardA11y", { name })} onPress={onDiscard} color={colors.textSecondary} />
              </>
            ) : canEdit ? (
              <>
                {dot}
                <Action
                  label={t("tasks.comments.edit")}
                  a11y={t("tasks.comments.editA11y", { name })}
                  onPress={() => {
                    setDraft(comment.text);
                    setEditing(true);
                  }}
                  color={colors.accentStrong}
                />
                {dot}
                <Action label={t("tasks.comments.delete")} a11y={t("tasks.comments.deleteA11y", { name })} onPress={confirmDelete} color={colors.danger} />
              </>
            ) : null}
          </View>
        )}
      </View>
      {failed || editing ? null : <CommentBell state={bell} onPress={onToggleRemind} />}
    </View>
  );
}
