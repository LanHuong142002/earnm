import { useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useIdeas } from "../../../../../../../ideas/IdeasProvider";
import { IDEA_STATUSES } from "../../../../../../../ideas/types";
import { useIdeaScreen } from "../../../../../../../ideas/useIdeaScreen";
import { SheetFrame, SheetLink } from "../../../../../../../tasks/SheetFrame";
import { useTheme } from "../../../../../../../theme/useTheme";
import { Card } from "../../../../../../../ui/Card";
import { PressableScale } from "../../../../../../../ui/PressableScale";

/** The status sheet (mockup 2b): the four statuses, the current one highlighted (no tick); a tap saves at once. */
export default function IdeaStatusSheet() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, typography, layout, spacing } = useTheme();
  const { id, ideaId } = useLocalSearchParams<{ id: string; ideaId: string }>();
  const { setStatus } = useIdeas();
  // If the idea vanishes while the sheet is open, this hook takes the person back to the ideas list.
  const { idea } = useIdeaScreen(id, ideaId);

  const title = t("ideas.statusSheetTitle");
  const done = <SheetLink label={t("ideas.done")} onPress={() => router.back()} strong />;
  if (!idea) {
    return (
      <SheetFrame title={title} right={done}>
        <View />
      </SheetFrame>
    );
  }

  return (
    <SheetFrame title={title} right={done}>
      <Card flush>
        <View accessibilityRole="radiogroup">
          {IDEA_STATUSES.map((status, index) => {
            const selected = idea.status === status;
            return (
              <PressableScale
                key={status}
                accessibilityRole="radio"
                accessibilityLabel={t(`ideas.status.${status}`)}
                accessibilityState={{ selected, checked: selected }}
                onPress={() => {
                  if (!selected) void setStatus(id, idea.id, status);
                  router.back();
                }}
                style={{
                  minHeight: layout.controlHeight,
                  justifyContent: "center",
                  paddingHorizontal: spacing[2],
                  backgroundColor: selected ? colors.tile : "transparent",
                  borderTopWidth: index > 0 ? 1 : 0,
                  borderTopColor: colors.border,
                }}
              >
                <Text style={[selected ? typography.bodyStrong : typography.body, { color: selected ? colors.accentStrong : colors.text }]}>
                  {t(`ideas.status.${status}`)}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </Card>
    </SheetFrame>
  );
}
