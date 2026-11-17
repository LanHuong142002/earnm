import { useState } from "react";
import { Modal, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/useTheme";
import { SheetFrame, SheetLink } from "../SheetFrame";
import { captionCounter } from "./photoUi";
import { CAPTION_MAX, captionCheck } from "./view";

/**
 * The caption sheet (mockup 3c): "Huỷ", "Chú thích", "Lưu" and a field of at most 200 characters. Saving an empty
 * field clears the caption. A bottom sheet over the viewer, so it is a modal here rather than a route.
 */
export function CaptionSheet({
  visible,
  initial,
  onCancel,
  onSave,
}: {
  visible: boolean;
  initial: string;
  onCancel: () => void;
  /** Gets the trimmed text to save. */
  onSave: (value: string) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      {/* Mounted only while open, so each opening starts from the photo's current caption. */}
      {visible ? <CaptionBody initial={initial} onCancel={onCancel} onSave={onSave} /> : null}
    </Modal>
  );
}

function CaptionBody({ initial, onCancel, onSave }: { initial: string; onCancel: () => void; onSave: (value: string) => void }) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const [text, setText] = useState(initial);
  const [focused, setFocused] = useState(false);

  const check = captionCheck(text);
  const counter = captionCounter(check.length);

  return (
    <SheetFrame
      title={t("tasks.photos.captionTitle")}
      left={<SheetLink label={t("tasks.photos.captionCancel")} onPress={onCancel} />}
      right={<SheetLink strong label={t("tasks.photos.captionSave")} onPress={() => check.canSave && onSave(check.value)} />}
    >
      <View style={{ gap: spacing[0] }}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          maxLength={CAPTION_MAX}
          placeholder={t("tasks.photos.captionPlaceholder")}
          placeholderTextColor={colors.placeholder}
          accessibilityLabel={t("tasks.photos.captionField")}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            typography.body,
            {
              minHeight: 72,
              textAlignVertical: "top",
              color: colors.text,
              backgroundColor: colors.field,
              borderRadius: radius.field,
              borderWidth: 1.5,
              borderColor: focused ? colors.accent : "transparent",
              paddingHorizontal: spacing[2],
              paddingVertical: spacing[1],
            },
          ]}
        />
        {counter ? (
          <Text
            accessibilityLabel={t(counter.over ? "tasks.photos.captionOverA11y" : "tasks.photos.captionCounterA11y", {
              remaining: counter.remaining,
              over: -counter.remaining,
            })}
            style={[typography.caption, { alignSelf: "flex-end", color: counter.over ? colors.danger : colors.textSecondary }]}
          >
            {t("tasks.photos.captionCounter", { remaining: counter.remaining })}
          </Text>
        ) : null}
      </View>
    </SheetFrame>
  );
}
