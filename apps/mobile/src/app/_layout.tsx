import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";

import { AuthProvider, useAuth } from "../auth/AuthProvider";
import i18n from "../i18n";

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== "loading") SplashScreen.hide();
  }, [status]);

  if (status === "loading") return null;
  return (
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
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_800ExtraBold,
  });

  // Keep the splash screen up until the fonts are ready (or failed, so the app still opens).
  if (!fontsLoaded && !fontError) return null;

  return (
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </I18nextProvider>
  );
}
