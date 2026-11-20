import { useHeaderHeight } from "expo-router/react-navigation";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useDrafts } from "../../../../../../drafts/DraftsProvider";
import { baseSize, DRAFT_NAME_MAX, DRAFT_NOTE_MAX } from "../../../../../../drafts/view";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useGoToProjectList } from "../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../projects/routing";
import { Hint } from "../../../../../../products/ProductBits";
import { SizePills } from "../../../../../../products/SizePills";
import type { SizeName } from "../../../../../../products/types";
import { toggleSize, validateName } from "../../../../../../products/view";
import { useTheme } from "../../../../../../theme/useTheme";
import { Button } from "../../../../../../ui/Button";
import { ErrorText } from "../../../../../../ui/ErrorText";
import { Screen } from "../../../../../../ui/Screen";
import { TextField } from "../../../../../../ui/TextField";

export default function NewDraftScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const headerHeight = useHeaderHeight();
  const { colors, typography, spacing } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const { createDraft } = useDrafts();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const [name, setName] = useState("");
  const [sizes, setSizes] = useState<SizeName[]>(["M"]);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  if (!project) return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;

  const problem = validateName(name, [], DRAFT_NAME_MAX);
  const noteProblem = note.length > DRAFT_NOTE_MAX;
  const base = baseSize(sizes);

  async function submit() {
    if (inFlight.current || !project) return;
    setSubmitted(true);
    setFormError(null);
    if (problem || noteProblem) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await createDraft(project.id, { name: name.trim(), sizes, note: note.trim() });
      if (result.ok) {
        // The draft takes this form's place, so back returns to the list.
        router.replace({ pathname: "/projects/[id]/drafts/[draftId]", params: { id: project.id, draftId: result.id } });
      } else {
        setFormError(t("errors.generic"));
      }
    } catch {
      setFormError(t("errors.generic"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen edges={[]} keyboardOffset={headerHeight} footer={<Button label={t("drafts.create")} loading={busy} onPress={submit} />}>
      <View style={{ gap: spacing[2] }}>
        <TextField
          label={t("drafts.nameLabel")}
          icon="cafe-outline"
          placeholder={t("drafts.namePlaceholder")}
          autoFocus
          value={name}
          onChangeText={setName}
          error={submitted && problem ? t(`drafts.errors.${problem === "nameDuplicate" ? "nameEmpty" : problem}`) : null}
          returnKeyType="next"
        />
        <View style={{ gap: spacing[0] }}>
          <Text style={[typography.label, { color: colors.text }]}>{t("drafts.sizesLabel")}</Text>
          <SizePills value={sizes} onToggle={(size) => setSizes((c) => toggleSize(c, size))} />
          <Hint>{base ? `${t("drafts.sizeBase", { size: base })}. ${t("drafts.sizesHint")}` : t("drafts.sizesHint")}</Hint>
        </View>
        <TextField
          label={t("drafts.noteLabel")}
          icon="document-text-outline"
          placeholder={t("drafts.notePlaceholder")}
          value={note}
          multiline
          onChangeText={setNote}
          error={submitted && noteProblem ? t("drafts.errors.noteTooLong") : null}
        />
        {formError ? <ErrorText message={formError} /> : null}
      </View>
    </Screen>
  );
}
