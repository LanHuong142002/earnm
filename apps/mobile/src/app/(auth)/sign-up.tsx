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

export default function SignUpScreen() {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const { colors, typography, spacing } = useTheme();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current) return;
    const name = displayName.trim();
    if (
      email.trim() === "" ||
      password.length < 8 ||
      password.length > 128 ||
      name.length < 1 ||
      name.length > 50
    ) {
      setError(t("errors.validation_failed"));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await signUp(email.trim(), password, name);
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
          <Button label={t("auth.signUpButton")} loading={busy} onPress={submit} />
          <Link href="/sign-in" style={{ paddingVertical: spacing[2], textAlign: "center" }}>
            <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>
              {t("auth.goToSignIn")}
            </Text>
          </Link>
        </>
      }
    >
      <Enter index={0}>
        <AuthHeader title={t("auth.signUpTitle")} subtitle={t("auth.signUpSubtitle")} />
      </Enter>
      <Enter index={1}>
        <View style={{ gap: spacing[2] }}>
          <TextField
            label={t("auth.displayName")}
            icon="person-outline"
            value={displayName}
            onChangeText={setDisplayName}
            autoComplete="name"
            textContentType="name"
            maxLength={50}
            editable={!busy}
          />
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
            autoComplete="new-password"
            autoCorrect={false}
            secureTextEntry
            textContentType="newPassword"
            editable={!busy}
            onSubmitEditing={submit}
          />
          {error ? <ErrorText message={error} /> : null}
        </View>
      </Enter>
    </Screen>
  );
}
