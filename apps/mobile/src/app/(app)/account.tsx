import { Alert, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import type { Language } from "../../i18n";
import { useProjects } from "../../projects/ProjectsProvider";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { AppearancePicker, useContentFade } from "../../ui/AppearancePicker";
import { Card } from "../../ui/Card";
import { ChoiceRow } from "../../ui/ChoiceRow";
import { Enter } from "../../ui/Enter";
import { Screen } from "../../ui/Screen";

const LANGUAGES: Language[] = ["vi", "en"];

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { setLanguage, signOut, languagePendingSync, profile } = useAuth();
  const { colors, typography, spacing, layout } = useTheme();
  const { waitingCount } = useProjects();
  const fade = useContentFade();
  const current: Language = i18n.language === "vi" ? "vi" : "en";

  function confirmSignOut() {
    if (waitingCount === 0) {
      void signOut();
      return;
    }
    Alert.alert(
      t("settings.signOutWaitingTitle"),
      t("settings.signOutWaitingMessage", { count: waitingCount }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("settings.signOut"), style: "destructive", onPress: () => void signOut() },
      ],
    );
  }

  return (
    <Screen edges={[]}>
      <Animated.View style={[{ gap: layout.sectionGap }, fade.style]}>
      {profile ? (
        <Enter index={0}>
          <View style={{ gap: spacing[1] }}>
            <Text
              accessibilityRole="header"
              style={[typography.sectionTitle, { color: colors.text }]}
            >
              {t("profile.title")}
            </Text>
            <Card>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>{profile.displayName}</Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>{profile.email}</Text>
            </Card>
          </View>
        </Enter>
      ) : null}
      <Enter index={1}>
        <View style={{ gap: spacing[1] }}>
          <Text
            accessibilityRole="header"
            style={[typography.sectionTitle, { color: colors.text }]}
          >
            {t("settings.language")}
          </Text>
          <Card>
            <View accessibilityRole="radiogroup">
              {LANGUAGES.map((lang, i) => (
                <ChoiceRow
                  key={lang}
                  label={t(`language.${lang}`)}
                  selected={lang === current}
                  divider={i > 0}
                  onPress={() => setLanguage(lang).catch(() => undefined)}
                />
              ))}
            </View>
          </Card>
          {languagePendingSync ? (
            <Text style={[typography.label, { color: colors.textSecondary }]}>
              {t("settings.pendingSync")}
            </Text>
          ) : null}
        </View>
      </Enter>
      <Enter index={2}>
        <View style={{ gap: spacing[1] }}>
          <Text
            accessibilityRole="header"
            style={[typography.sectionTitle, { color: colors.text }]}
          >
            {t("settings.appearance.title")}
          </Text>
          <AppearancePicker contentOpacity={fade.opacity} />
        </View>
      </Enter>
      <Enter index={3}>
        <Button label={t("settings.signOut")} variant="danger" onPress={confirmSignOut} />
      </Enter>
      </Animated.View>
    </Screen>
  );
}
