import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/useTheme";
import { ErrorText } from "../../ui/ErrorText";
import { PressableScale } from "../../ui/PressableScale";
import type { CommentResult } from "./useTaskComments";
import { COMMENT_MAX, lengthCheck } from "./view";

/** The write field at the top of the section: multi-line, a send button, and "Nhắc kèm" for involved people. */
export function CommentComposer({
  involved,
  onSend,
}: {
  involved: boolean;
  onSend: (text: string, remindWith: boolean) => Promise<CommentResult>;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, radius, spacing, iconSize, disabled: disabledStyle } = useTheme();
  const [text, setText] = useState("");
  const [remind, setRemind] = useState(false);
  const [focused, setFocused] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const check = lengthCheck(text);
  const tooLong = check.over > 0;

  const send = async () => {
    if (busy.current || !check.canSend) return;
    busy.current = true;
    try {
      const result = await onSend(text, remind);
      setFailed(!result.ok);
      if (result.ok) {
        setText("");
        setRemind(false);
      }
    } finally {
      busy.current = false;
    }
  };

  return (
    <View style={{ gap: spacing[0] }}>
      {involved ? (
        <PressableScale
          accessibilityRole="switch"
          accessibilityLabel={t("tasks.comments.remindA11y")}
          accessibilityState={{ checked: remind }}
          onPress={() => setRemind((v) => !v)}
          style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: spacing[0], minHeight: layout.controlHeight }}
        >
          <Ionicons
            name={remind ? "notifications" : "notifications-outline"}
            size={iconSize.sm}
            color={remind ? colors.accentStrong : colors.textSecondary}
          />
          <Text style={[typography.label, { color: remind ? colors.accentStrong : colors.textSecondary }]}>
            {t(remind ? "tasks.comments.remindOn" : "tasks.comments.remindOff")}
          </Text>
        </PressableScale>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing[1] }}>
        <View
          style={{
            flex: 1,
            minHeight: layout.controlHeight,
            justifyContent: "center",
            paddingHorizontal: spacing[2],
            paddingVertical: spacing[1],
            borderRadius: radius.card,
            borderWidth: 1.5,
            borderColor: tooLong ? colors.danger : focused ? colors.accent : "transparent",
            backgroundColor: tooLong ? colors.dangerBg : colors.field,
          }}
        >
          <TextInput
            value={text}
            onChangeText={(v) => {
              setText(v);
              setFailed(false);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            multiline
            accessibilityLabel={t("tasks.comments.composerA11y")}
            placeholder={t("tasks.comments.placeholder")}
            placeholderTextColor={colors.placeholder}
            style={[typography.body, { color: colors.text, paddingVertical: 0, maxHeight: layout.controlHeight * 3 }]}
          />
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("tasks.comments.send")}
          accessibilityState={{ disabled: !check.canSend }}
          disabled={!check.canSend}
          onPress={() => void send()}
          style={{
            width: layout.controlHeight,
            height: layout.controlHeight,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.accentStrong,
            opacity: check.canSend ? 1 : disabledStyle.opacity,
          }}
        >
          <Ionicons name="send" size={iconSize.sm} color={colors.onAccent} />
        </PressableScale>
      </View>
      {tooLong ? (
        <ErrorText message={t("tasks.comments.tooLong", { max: COMMENT_MAX, length: check.length, over: check.over })} />
      ) : failed ? (
        <ErrorText message={t("tasks.comments.notReady")} />
      ) : null}
    </View>
  );
}
