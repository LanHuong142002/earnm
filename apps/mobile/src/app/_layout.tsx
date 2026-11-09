import { Stack } from "expo-router";
import { I18nextProvider } from "react-i18next";

import { AuthProvider, useAuth } from "../auth/AuthProvider";
import i18n from "../i18n";

function RootNavigator() {
  const { status } = useAuth();
  if (status === "loading") return null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedIn"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </I18nextProvider>
  );
}
