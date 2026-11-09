import { useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { AuthHeader, fieldError, type AuthField } from "../../auth/AuthForm";
import { useAuth } from "../../auth/AuthProvider";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { Enter } from "../../ui/Enter";
import { ErrorText } from "../../ui/ErrorText";
import { Screen } from "../../ui/Screen";
import { TextField } from "../../ui/TextField";
import { TextLink } from "../../ui/TextLink";

export default function SignInScreen() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const { spacing } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErr, setFieldErr] = useState<{ field: AuthField | null; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const errorFor = (field: AuthField) => (fieldErr?.field === field ? fieldErr.message : null);
  const formError = fieldErr && fieldErr.field === null ? fieldErr.message : null;

  async function submit() {
    if (inFlight.current) return;
    if (email.trim() === "" || password === "") {
      setFieldErr({
        field: email.trim() === "" ? "email" : "password",
        message: t("errors.validation_failed"),
      });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFieldErr(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setFieldErr(fieldError(e, t));
      setPassword("");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={<Button label={t("auth.signInButton")} loading={busy} onPress={submit} />}
    >
      <Enter index={0}>
        <AuthHeader title={t("auth.signInTitle")} subtitle={t("auth.signInSubtitle")} />
      </Enter>
      <Enter index={1}>
        <View style={{ gap: spacing[2] }}>
          <TextField
            label={t("auth.email")}
            error={errorFor("email")}
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
            error={errorFor("password")}
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
        </View>
      </Enter>
      <Enter index={2}>
        <View style={{ gap: spacing[2] }}>
          {formError ? <ErrorText message={formError} /> : null}
          <TextLink href="/sign-up" label={t("auth.goToSignUp")} />
        </View>
      </Enter>
    </Screen>
  );
}
