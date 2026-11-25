import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { Appearance } from "react-native";
import { I18nextProvider } from "react-i18next";

import { AuthProvider, useAuth } from "../auth/AuthProvider";
import i18n from "../i18n";
import { IdeasProvider } from "../ideas/IdeasProvider";
import { IngredientsProvider } from "../ingredients/IngredientsProvider";
import { DraftsProvider } from "../drafts/DraftsProvider";
import { ProductsProvider } from "../products/ProductsProvider";
import { ProjectsProvider } from "../projects/ProjectsProvider";
import { asyncStorageStore } from "../sync/asyncStorageStore";
import { NotificationGlue } from "../tasks/reminders/NotificationGlue";
import { TasksProvider } from "../tasks/TasksProvider";
import { readAppearance, schemeOverride } from "../theme/appearance";

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== "loading") SplashScreen.hide();
  }, [status]);

  if (status === "loading") return null;
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={status === "signedOut"}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* Signed out, "/" (app)/index is guarded off; without redirectTo the router falls back to
            the "(auth)" group, which has no index and shows Unmatched Route. */}
        <Stack.Protected guard={status === "signedIn"} redirectTo="/sign-in">
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
      {/* After the navigator, so a tapped notification has a stack to push onto. */}
      {status === "signedIn" ? <NotificationGlue /> : null}
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_800ExtraBold,
  });

  // Apply the saved appearance before the first screen renders (the splash stays up until then).
  const [appearanceReady, setAppearanceReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void readAppearance(asyncStorageStore)
      .then((choice) => Appearance.setColorScheme(schemeOverride(choice)))
      .catch(() => undefined)
      .finally(() => {
        if (alive) setAppearanceReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Keep the splash screen up until the fonts and appearance are ready (or failed, so the app still opens).
  if ((!fontsLoaded && !fontError) || !appearanceReady) return null;

  return (
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <ProjectsProvider>
          <TasksProvider>
            <IdeasProvider>
              <IngredientsProvider>
                <ProductsProvider>
                  <DraftsProvider>
                    <RootNavigator />
                  </DraftsProvider>
                </ProductsProvider>
              </IngredientsProvider>
            </IdeasProvider>
          </TasksProvider>
        </ProjectsProvider>
      </AuthProvider>
    </I18nextProvider>
  );
}
