import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useState } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

import { useTheme } from "../theme/useTheme";
import { ErrorText } from "./ErrorText";

type Props = Omit<TextInputProps, "style"> & {
  label: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  invalid?: boolean;
  /** Message shown under the field; also marks it invalid. */
  error?: string | null;
};

export function TextField({ label, icon, invalid: invalidProp = false, error, onFocus, onBlur, ...rest }: Props) {
  const { colors, typography, layout, radius, spacing, iconSize } = useTheme();
  const invalid = invalidProp || !!error;
  const [focused, setFocused] = useState(false);
  const borderColor = invalid ? colors.danger : focused ? colors.accent : "transparent";

  return (
    <View style={{ gap: spacing[0] }}>
      <Text style={[typography.label, { color: colors.text }]}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          minHeight: layout.controlHeight,
          paddingHorizontal: spacing[2],
          borderRadius: radius.field,
          borderWidth: 1.5,
          borderColor,
          backgroundColor: invalid ? colors.dangerBg : colors.field,
        }}
      >
        <Ionicons name={icon} size={iconSize.sm} color={colors.placeholder} />
        <TextInput
          {...rest}
          accessibilityLabel={label}
          placeholderTextColor={colors.placeholder}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[typography.body, { flex: 1, color: colors.text, paddingVertical: 0 }]}
        />
      </View>
      {error ? <ErrorText message={error} /> : null}
    </View>
  );
}
