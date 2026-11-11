import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useTheme } from "../theme/useTheme";

// Safe area, screen padding, content at the top. `footer` (a form's main button) sits at the bottom.
export function Screen({
  children,
  footer,
  edges = ["top", "bottom"],
  keyboardOffset = 0,
}: {
  children: ReactNode;
  footer?: ReactNode;
  edges?: Edge[];
  /** Space above the screen the keyboard-avoiding view cannot see, e.g. a navigation header's height. */
  keyboardOffset?: number;
}) {
  const { colors, layout, spacing } = useTheme();
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        keyboardVerticalOffset={keyboardOffset}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={{
            padding: layout.screenPadding,
            paddingTop: spacing[3],
            gap: layout.sectionGap,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer ? (
          <View
            style={{
              paddingHorizontal: layout.screenPadding,
              paddingBottom: spacing[1],
              gap: spacing[0],
            }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
