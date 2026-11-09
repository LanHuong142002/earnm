import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import type { Language } from "../../i18n";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { ChoiceRow } from "../../ui/ChoiceRow";
import { Enter } from "../../ui/Enter";
import { Screen } from "../../ui/Screen";

const LANGUAGES: Language[] = ["vi", "en"];

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { setLanguage, signOut } = useAuth();
  const { colors, typography, spacing } = useTheme();
  const current: Language = i18n.language === "vi" ? "vi" : "en";

  return (
    <Screen edges={["bottom"]}>
      <Enter index={0}>
        <View style={{ gap: spacing[1] }}>
          <Text
            accessibilityRole="header"
            style={[typography.sectionTitle, { color: colors.text }]}
          >
            {t("settings.language")}
          </Text>
          <Card>
            <View accessibilityRole="radiogroup">
              {LANGUAGES.map((lang) => (
                <ChoiceRow
                  key={lang}
                  label={t(`language.${lang}`)}
                  selected={lang === current}
                  onPress={() => void setLanguage(lang)}
                />
              ))}
            </View>
          </Card>
        </View>
      </Enter>
      <Enter index={1}>
        <Button label={t("settings.signOut")} variant="danger" onPress={() => void signOut()} />
      </Enter>
    </Screen>
  );
}
