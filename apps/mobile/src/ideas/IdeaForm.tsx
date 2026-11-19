import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { Label } from "../tasks/types";
import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { Enter } from "../ui/Enter";
import { ErrorText } from "../ui/ErrorText";
import { Screen } from "../ui/Screen";
import { TextField } from "../ui/TextField";
import { editFromIdeaForm, ideaErrorKeys, toggleIdeaLabel, type IdeaFormValues } from "./formState";
import type { IdeaMutationResult } from "./IdeasProvider";
import { LabelToggle } from "./LabelToggle";
import type { IdeaEdit } from "./plan";

/** Shared by New idea and Edit idea (mockups 3a, 3b). `onSubmit` returns the provider's result. */
export function IdeaForm({
  initial,
  labels,
  submitLabel,
  onSubmit,
  photos,
  extra,
}: {
  initial: IdeaFormValues;
  /** The project's labels, to choose from. */
  labels: readonly Label[];
  submitLabel: string;
  /** `opened` is what the form started with; `changed` has only what the person changed. */
  onSubmit: (form: IdeaFormValues, changed: IdeaEdit) => Promise<IdeaMutationResult>;
  /** The Ảnh section: Edit passes the photos of the idea; New has no idea to hold them yet. */
  photos: ReactNode;
  /** Set-apart section at the end of the scrolling form, e.g. the delete button. */
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  // The Home stack header sits above this screen; the keyboard overlap must account for it.
  const headerHeight = useHeaderHeight();
  const opened = useRef(initial).current;
  const [form, setForm] = useState<IdeaFormValues>(initial);
  const [errorKeys, setErrorKeys] = useState<ReturnType<typeof ideaErrorKeys>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const descriptionRef = useRef<ComponentRef<typeof TextInput>>(null);

  const message = (key?: string) => (key ? t(key) : null);

  function toggle(id: string) {
    const next = toggleIdeaLabel(form.labelIds, id);
    setForm((f) => ({ ...f, labelIds: next.ids }));
    setErrorKeys((e) => ({ ...e, labels: next.limit ? "ideas.errors.labelsTooMany" : undefined }));
  }

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setErrorKeys({});
    setFormError(null);
    try {
      const result = await onSubmit(form, editFromIdeaForm(opened, form));
      if (!result.ok) {
        // Empty errors means the change could not be attributed yet (not ready): a general message.
        if (Object.keys(result.errors).length === 0) setFormError(t("errors.generic"));
        else setErrorKeys(ideaErrorKeys(result.errors));
      }
    } catch {
      setFormError(t("errors.generic"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen edges={[]} keyboardOffset={headerHeight} footer={<Button label={submitLabel} loading={busy} onPress={submit} />}>
      <Enter index={0}>
        <View style={{ gap: spacing[2] }}>
          <TextField
            label={t("ideas.titleLabel")}
            icon="bulb-outline"
            error={message(errorKeys.title)}
            value={form.title}
            onChangeText={(title) => setForm((f) => ({ ...f, title }))}
            autoCapitalize="sentences"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => descriptionRef.current?.focus()}
            editable={!busy}
          />
          <TextField
            label={t("ideas.descriptionOptional")}
            icon="document-text-outline"
            placeholder={t("ideas.descriptionPlaceholder")}
            error={message(errorKeys.description)}
            value={form.description}
            onChangeText={(description) => setForm((f) => ({ ...f, description }))}
            multiline
            inputRef={descriptionRef}
            // Return adds a line; the Save button below submits.
            submitBehavior="newline"
            editable={!busy}
          />
          <View style={{ gap: spacing[0] }}>
            <Text style={[typography.label, { color: colors.text }]}>{t("ideas.labelsLabel")}</Text>
            {labels.length === 0 ? (
              <Text style={[typography.body, { color: colors.textSecondary }]}>{t("ideas.labelsNoneInProject")}</Text>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing[0] }}>
                {labels.map((label) => (
                  <LabelToggle key={label.id} label={label} selected={form.labelIds.includes(label.id)} onPress={() => toggle(label.id)} />
                ))}
              </View>
            )}
            {errorKeys.labels ? <ErrorText message={t(errorKeys.labels)} /> : null}
          </View>
          {photos}
          {formError ? <ErrorText message={formError} /> : null}
        </View>
      </Enter>
      {extra ? (
        <Enter index={1}>
          {/* Set apart from the form, with room below, so it can't be hit when reaching for Save. */}
          <View
            style={{
              marginTop: spacing[6],
              marginBottom: spacing[6],
              paddingTop: spacing[5],
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            {extra}
          </View>
        </Enter>
      ) : null}
    </Screen>
  );
}
