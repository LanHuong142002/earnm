import { Link } from "expo-router";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AuthHeader, errorMessage } from "../../auth/AuthForm";
import { useAuth } from "../../auth/AuthProvider";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Enter } from "../../ui/Enter";
import { ErrorText } from "../../ui/ErrorText";
import { Screen } from "../../ui/Screen";
import { TextField } from "../../ui/TextField";

export default function SignInScreen() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const { colors, typography, spacing } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current) return;
    if (email.trim() === "" || password === "") {
      setError(t("errors.validation_failed"));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(errorMessage(e, t));
      setPassword("");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button label={t("auth.signInButton")} loading={busy} onPress={submit} />
          <Link href="/sign-up" style={{ paddingVertical: spacing[2], textAlign: "center" }}>
            <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>
              {t("auth.goToSignUp")}
            </Text>
          </Link>
        </>
      }
    >
      <Enter index={0}>
        <AuthHeader title={t("auth.signInTitle")} subtitle={t("auth.signInSubtitle")} />
      </Enter>
      <Enter index={1}>
        <View style={{ gap: spacing[2] }}>
          <TextField
            label={t("auth.email")}
            icon="mail-outline"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!busy}
          />
          <TextField
            label={t("auth.password")}
            icon="lock-closed-outline"
            invalid={error !== null}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoComplete="current-password"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            editable={!busy}
            onSubmitEditing={submit}
          />
          {error ? <ErrorText message={error} /> : null}
        </View>
      </Enter>
    </Screen>
  );
}
