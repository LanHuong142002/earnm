import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { fontFamily } from "../../../theme/tokens";
import { useTheme } from "../../../theme/useTheme";
import { HeaderBack } from "../../../ui/HeaderBack";

const sheet = {
  presentation: "formSheet" as const,
  headerShown: false,
  sheetAllowedDetents: [0.6, 1],
  sheetGrabberVisible: true,
  sheetExpandsWhenScrolledToEdge: true,
};

// Screens are pushed, so each has the native back control and (on iPhone) swipe-back.
export default function HomeStackLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        gestureEnabled: true,
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.accentStrong,
        headerTitleStyle: { fontFamily: fontFamily.extraBold, color: colors.text },
        headerLeft: (props) => <HeaderBack canGoBack={props.canGoBack} />,
      }}
    >
      <Stack.Screen name="index" options={{ title: t("common.appName") }} />
      <Stack.Screen name="projects/index" options={{ title: t("projects.title") }} />
      <Stack.Screen name="projects/new" options={{ title: t("projects.newTitle") }} />
      <Stack.Screen name="projects/join" options={{ title: t("join.title") }} />
      <Stack.Screen name="projects/[id]/index" options={{ title: t("projects.projectTitle") }} />
      <Stack.Screen name="projects/[id]/edit" options={{ title: t("projects.editTitle") }} />
      <Stack.Screen name="projects/[id]/tasks/index" options={{ title: t("tasks.title") }} />
      <Stack.Screen name="projects/[id]/tasks/new" options={{ title: t("tasks.newTitle") }} />
      <Stack.Screen
        name="projects/[id]/tasks/[taskId]/index"
        options={{ title: t("tasks.detailsTitle"), headerTitleAlign: "center" }}
      />
      <Stack.Screen name="projects/[id]/tasks/[taskId]/edit" options={{ title: t("tasks.editTitle") }} />
      <Stack.Screen name="projects/[id]/tasks/[taskId]/reminders/new" options={{ title: t("tasks.reminders.newTitle") }} />
      <Stack.Screen name="projects/[id]/tasks/[taskId]/reminders/[reminderId]" options={{ title: t("tasks.reminders.editTitle") }} />
      {/* The explanation sheet before iOS asks for notifications. */}
      <Stack.Screen
        name="projects/[id]/tasks/[taskId]/reminders/permission"
        options={{ ...sheet, sheetAllowedDetents: [0.5], title: t("tasks.reminders.permission.title") }}
      />
      {/* The photo viewer: full screen on black, with its own close button. */}
      <Stack.Screen
        name="projects/[id]/tasks/[taskId]/photos"
        options={{ presentation: "fullScreenModal", headerShown: false, animation: "fade", title: t("tasks.photos.viewerTitle") }}
      />
      <Stack.Screen
        name="projects/[id]/tasks/labels/index"
        options={{ title: t("tasks.labels.manageTitle"), headerTitleAlign: "center" }}
      />
      {/* Bottom sheets (iOS formSheet with a grabber; Android falls back to a modal). The sheet draws its own head. */}
      <Stack.Screen name="projects/[id]/tasks/labels/filter" options={{ ...sheet, title: t("tasks.labels.filterTitle") }} />
      <Stack.Screen name="projects/[id]/tasks/labels/pick" options={{ ...sheet, title: t("tasks.labels.pickTitle") }} />
      <Stack.Screen
        name="projects/[id]/tasks/labels/form"
        options={{ ...sheet, sheetAllowedDetents: [0.8, 1], title: t("tasks.labels.newTitle") }}
      />
      <Stack.Screen name="projects/[id]/ideas/index" options={{ title: t("ideas.title") }} />
      <Stack.Screen name="projects/[id]/ideas/new" options={{ title: t("ideas.newTitle") }} />
      <Stack.Screen
        name="projects/[id]/ideas/[ideaId]/index"
        options={{ title: t("ideas.detailsTitle"), headerTitleAlign: "center" }}
      />
      <Stack.Screen name="projects/[id]/ideas/[ideaId]/edit" options={{ title: t("ideas.editTitle") }} />
      {/* The status sheet: iOS formSheet with a grabber; Android falls back to a modal. It draws its own head. */}
      <Stack.Screen name="projects/[id]/ideas/[ideaId]/status" options={{ ...sheet, title: t("ideas.statusSheetTitle") }} />
      {/* The photo viewer: full screen on black, with its own close button. */}
      <Stack.Screen
        name="projects/[id]/ideas/[ideaId]/photos"
        options={{ presentation: "fullScreenModal", headerShown: false, animation: "fade", title: t("tasks.photos.viewerTitle") }}
      />
      <Stack.Screen name="projects/[id]/ingredients/index" options={{ title: t("ingredients.title") }} />
      <Stack.Screen name="projects/[id]/ingredients/new" options={{ title: t("ingredients.newTitle") }} />
      <Stack.Screen name="projects/[id]/ingredients/[ingredientId]" options={{ title: t("ingredients.editTitle") }} />
      <Stack.Screen name="projects/[id]/products/index" options={{ title: t("products.title") }} />
      <Stack.Screen name="projects/[id]/products/new" options={{ title: t("products.newTitle") }} />
      <Stack.Screen name="projects/[id]/products/[productId]" options={{ title: t("products.title") }} />
      <Stack.Screen name="projects/[id]/products/extra-costs" options={{ title: t("products.extra.title") }} />
      <Stack.Screen name="projects/[id]/fixed-costs/index" options={{ title: t("fixedCosts.title") }} />
      <Stack.Screen name="projects/[id]/fixed-costs/new" options={{ title: t("fixedCosts.newTitle") }} />
      <Stack.Screen name="projects/[id]/fixed-costs/[fixedCostId]" options={{ title: t("fixedCosts.editTitle") }} />
      <Stack.Screen name="projects/[id]/members" options={{ title: t("members.title") }} />
    </Stack>
  );
}
