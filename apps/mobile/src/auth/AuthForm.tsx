import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { ApiError } from "../lib/api";

export function errorMessage(error: unknown, t: TFunction): string {
  const code = error instanceof ApiError ? error.code : "generic";
  return t(`errors.${code}`, { defaultValue: t("errors.generic") });
}

export function FormShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <View style={styles.form}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Spinner() {
  const { t } = useTranslation();
  return <ActivityIndicator accessibilityLabel={t("common.loading")} color="#fff" />;
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 16 },
  form: { gap: 10 },
  label: { fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#888",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  error: { color: "#b00020", fontSize: 14 },
  button: {
    backgroundColor: "#1a5fd0",
    borderRadius: 8,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { color: "#1a5fd0", fontSize: 15, paddingVertical: 12, textAlign: "center" },
});
