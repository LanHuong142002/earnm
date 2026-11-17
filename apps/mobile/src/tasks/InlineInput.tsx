import { TextInput } from "react-native";

import { useTheme } from "../theme/useTheme";

/** A one-line field that sits in a card row (rename, edit item, add item). Return submits and keeps the focus. */
export function InlineInput({
  value,
  onChangeText,
  onSubmit,
  onBlur,
  accessibilityLabel,
  placeholder,
  invalid = false,
  autoFocus = true,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onBlur: () => void;
  accessibilityLabel: string;
  placeholder?: string;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const { colors, typography, radius, spacing } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmit}
      onBlur={onBlur}
      autoFocus={autoFocus}
      accessibilityLabel={accessibilityLabel}
      placeholder={placeholder}
      placeholderTextColor={colors.placeholder}
      autoCapitalize="sentences"
      returnKeyType="done"
      // Return submits without closing the keyboard, so the next item can be typed at once.
      submitBehavior="submit"
      style={[
        typography.body,
        {
          flex: 1,
          color: colors.text,
          minHeight: 38,
          paddingHorizontal: spacing[1],
          paddingVertical: 0,
          borderRadius: radius.field,
          borderWidth: 1.5,
          borderColor: invalid ? colors.danger : colors.accent,
          backgroundColor: invalid ? colors.dangerBg : colors.field,
        },
      ]}
    />
  );
}
