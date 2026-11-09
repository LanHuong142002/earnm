import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import type { Language } from "../../i18n";

const LANGUAGES: Language[] = ["vi", "en"];

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { setLanguage, signOut } = useAuth();
  const current: Language = i18n.language === "vi" ? "vi" : "en";

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("settings.language")}
      </Text>
      <Text>{t("settings.currentLanguage", { language: t(`language.${current}`) })}</Text>
      <View accessibilityRole="radiogroup" style={styles.group}>
        {LANGUAGES.map((lang) => {
          const selected = lang === current;
          return (
            <Pressable
              key={lang}
              accessibilityRole="radio"
              accessibilityLabel={t(`language.${lang}`)}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => void setLanguage(lang)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text style={styles.optionText}>
                {selected ? "✓ " : ""}
                {t(`language.${lang}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("settings.signOut")}
        onPress={() => void signOut()}
        style={styles.signOut}
      >
        <Text style={styles.signOutText}>{t("settings.signOut")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  heading: { fontSize: 18, fontWeight: "700" },
  group: { gap: 8 },
  option: {
    borderWidth: 1,
    borderColor: "#888",
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  optionSelected: { borderWidth: 2, borderColor: "#1a5fd0" },
  optionText: { fontSize: 16 },
  signOut: {
    marginTop: 24,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#b00020",
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: { color: "#b00020", fontSize: 16, fontWeight: "600" },
});
