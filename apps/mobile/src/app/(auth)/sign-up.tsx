import { Link } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, TextInput } from "react-native";
import { useTranslation } from "react-i18next";

import { errorMessage, FormShell, Spinner, styles } from "../../auth/AuthForm";
import { useAuth } from "../../auth/AuthProvider";

export default function SignUpScreen() {
  const { t } = useTranslation();
  const { signUp } = useAuth();
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
    <FormShell title={t("auth.signUpTitle")}>
      <Text style={styles.label}>{t("auth.displayName")}</Text>
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        accessibilityLabel={t("auth.displayName")}
        autoComplete="name"
        textContentType="name"
        maxLength={50}
        editable={!busy}
      />
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
        autoComplete="new-password"
        autoCorrect={false}
        secureTextEntry
        textContentType="newPassword"
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
        accessibilityLabel={t("auth.signUpButton")}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={submit}
        style={[styles.button, busy && styles.buttonDisabled]}
      >
        {busy ? <Spinner /> : <Text style={styles.buttonText}>{t("auth.signUpButton")}</Text>}
      </Pressable>
      <Link href="/sign-in" style={styles.link}>
        {t("auth.goToSignIn")}
      </Link>
    </FormShell>
  );
}
