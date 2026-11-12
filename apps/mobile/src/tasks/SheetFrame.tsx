import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";

/** A text link in a sheet's head ("Xong", "Hủy"). */
export function SheetLink({ label, onPress, strong = false }: { label: string; onPress: () => void; strong?: boolean }) {
  const { colors, typography, layout, spacing } = useTheme();
  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: layout.controlHeight, minWidth: layout.controlHeight, justifyContent: "center", paddingHorizontal: spacing[0] }}
    >
      <Text style={[strong ? typography.bodyStrong : typography.body, { color: colors.accentStrong }]}>{label}</Text>
    </PressableScale>
  );
}

/** Body of a bottom sheet: a head with a title between two slots, then the content. The native sheet draws the grabber. */
export function SheetFrame({
  title,
  left,
  right,
  children,
}: {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  const { colors, typography, layout, spacing } = useTheme();
  return (
    <SafeAreaView edges={["bottom"]} style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: layout.screenPadding,
            paddingTop: spacing[2],
          }}
        >
          <View style={{ flex: 1, alignItems: "flex-start" }}>{left}</View>
          <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          <View style={{ flex: 1, alignItems: "flex-end" }}>{right}</View>
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: layout.screenPadding, gap: layout.sectionGap }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
