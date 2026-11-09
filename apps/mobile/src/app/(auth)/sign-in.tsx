import { Link } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, TextInput } from "react-native";
import { useTranslation } from "react-i18next";

import { errorMessage, FormShell, Spinner, styles } from "../../auth/AuthForm";
import { useAuth } from "../../auth/AuthProvider";

export default function SignInScreen() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
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
    <FormShell title={t("auth.signInTitle")}>
      <Text style={styles.label}>{t("auth.email")}</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        accessibilityLabel={t("auth.email")}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!busy}
      />
      <Text style={styles.label}>{t("auth.password")}</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        accessibilityLabel={t("auth.password")}
        autoCapitalize="none"
        autoComplete="current-password"
        autoCorrect={false}
        secureTextEntry
        textContentType="password"
        editable={!busy}
        onSubmitEditing={submit}
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("auth.signInButton")}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={submit}
        style={[styles.button, busy && styles.buttonDisabled]}
      >
        {busy ? <Spinner /> : <Text style={styles.buttonText}>{t("auth.signInButton")}</Text>}
      </Pressable>
      <Link href="/sign-up" style={styles.link}>
        {t("auth.goToSignUp")}
      </Link>
    </FormShell>
  );
}
