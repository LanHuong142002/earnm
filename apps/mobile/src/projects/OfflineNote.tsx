import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../auth/AuthProvider";
import { useTheme } from "../theme/useTheme";
import { useProjects } from "./ProjectsProvider";

/** The small "Offline" line shown when the projects or the profile could not be reached. */
export function OfflineNote() {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { profileStatus } = useAuth();
  const { status } = useProjects();
  if (status !== "offline" && profileStatus !== "offline") return null;
  return <Text style={[typography.label, { color: colors.textSecondary }]}>{t("home.offline")}</Text>;
}
