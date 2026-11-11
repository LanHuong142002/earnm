import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ChoiceRow } from "../ui/ChoiceRow";
import { Enter } from "../ui/Enter";
import { ErrorText } from "../ui/ErrorText";
import { Screen } from "../ui/Screen";
import { TextField } from "../ui/TextField";
import type { MutationResult } from "./ProjectsProvider";
import { DESCRIPTION_MAX, NAME_MAX, type ProjectInput, type ProjectInputErrors } from "./store";

const CURRENCIES = ["VND", "USD"] as const;

/** Shared by the create and edit screens. `onSubmit` returns the provider's result. */
export function ProjectForm({
  initial,
  submitLabel,
  onSubmit,
  extra,
}: {
  initial: ProjectInput;
  submitLabel: string;
  /** `opened` is what the form started with, so callers can send only what the person changed. */
  onSubmit: (fields: ProjectInput, opened: ProjectInput) => Promise<MutationResult<object>>;
  /** Extra content below the form, e.g. a delete button. */
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  // The Home stack header sits above this screen; the keyboard overlap must account for it.
  const headerHeight = useHeaderHeight();
  const opened = useRef(initial).current;
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [currency, setCurrency] = useState(initial.currency);
  const [errors, setErrors] = useState<ProjectInputErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const descriptionRef = useRef<ComponentRef<typeof TextInput>>(null);

  const nameError = errors.name
    ? errors.name === "required"
      ? t("projects.errors.nameRequired")
      : t("projects.errors.nameTooLong", { max: NAME_MAX })
    : null;
  const descriptionError = errors.description
    ? t("projects.errors.descriptionTooLong", { max: DESCRIPTION_MAX })
    : null;
  const currencyError = errors.currency ? t("projects.errors.currencyInvalid") : null;

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await onSubmit({ name, description, currency }, opened);
      if (!result.ok) setErrors(result.errors);
    } catch {
      setFormError(t("errors.generic"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen
      edges={[]}
      keyboardOffset={headerHeight}
      footer={<Button label={submitLabel} loading={busy} onPress={submit} />}
    >
      <Enter index={0}>
        <View style={{ gap: spacing[2] }}>
          <TextField
            label={t("projects.name")}
            icon="folder-outline"
            error={nameError}
            value={name}
            onChangeText={setName}
            autoCapitalize="sentences"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => descriptionRef.current?.focus()}
            editable={!busy}
          />
          <View style={{ gap: spacing[0] }}>
            <Text style={[typography.label, { color: colors.text }]}>{t("projects.currency")}</Text>
            <Card>
              <View accessibilityRole="radiogroup">
                {CURRENCIES.map((code, i) => (
                  <ChoiceRow
                    key={code}
                    label={t(`projects.currencies.${code}`)}
                    selected={currency === code}
                    divider={i > 0}
                    onPress={() => setCurrency(code)}
                  />
                ))}
              </View>
            </Card>
            {currencyError ? <ErrorText message={currencyError} /> : null}
          </View>
          <TextField
            label={t("projects.descriptionOptional")}
            icon="document-text-outline"
            error={descriptionError}
            value={description}
            onChangeText={setDescription}
            multiline
            inputRef={descriptionRef}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => void submit()}
            editable={!busy}
          />
          {formError ? <ErrorText message={formError} /> : null}
        </View>
      </Enter>
      {extra ? <Enter index={1}>{extra}</Enter> : null}
    </Screen>
  );
}
