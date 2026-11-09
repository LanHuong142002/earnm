import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <View style={styles.container}>
      {user ? (
        <Text accessibilityRole="header" style={styles.title}>
          {t("home.welcome", { name: user.displayName })}
        </Text>
      ) : null}
      <Link href="/settings" style={styles.link}>
        {t("home.settingsLink")}
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: "700" },
  link: { color: "#1a5fd0", fontSize: 16, paddingVertical: 8 },
});
