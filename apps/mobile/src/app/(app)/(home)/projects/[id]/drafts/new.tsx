import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { getToken } from "../../../../../../auth/token-store";
import { useIdeas } from "../../../../../../ideas/IdeasProvider";
import { createDraftFromIdea } from "../../../../../../ideas/api";
import { createDraftErrorKey, ideaDraftBlock, prefilledDraftForm } from "../../../../../../ideas/draftPrefill";
import { ApiError } from "../../../../../../lib/api";
import { newProjectId } from "../../../../../../projects/newProjectId";
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
  const { id, fromIdea } = useLocalSearchParams<{ id: string; fromIdea?: string }>();
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
  if (fromIdea) return <NewDraftFromIdea projectId={project.id} ideaId={fromIdea} />;

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

/**
 * New draft opened from an accepted idea (spec R2-R5): the form is prefilled from the idea, and the server makes the
 * draft, links it and copies the photos in one call. It needs the network and queues nothing; a failure keeps what
 * the person typed and says why above the button.
 */
function NewDraftFromIdea({ projectId, ideaId }: { projectId: string; ideaId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const { colors, typography, spacing, iconSize } = useTheme();
  const { ready, ideasFor, refresh: refreshIdeas } = useIdeas();
  const { addServerDraft } = useDrafts();
  const [edits, setEdits] = useState<{ name?: string; note?: string }>({});
  const [sizes, setSizes] = useState<SizeName[]>(["M"]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // One draft id per opening of the form: pressing the button again after a lost answer cannot make two drafts.
  const draftId = useRef(newProjectId()).current;

  const idea = ready ? (ideasFor(projectId).find((x) => x.id === ideaId) ?? null) : null;
  // The idea is gone (deleted meanwhile): nothing to make a draft from.
  useEffect(() => {
    if (ready && idea === null) router.back();
  }, [ready, idea, router]);

  if (!idea) return <Screen edges={[]}>{null}</Screen>;
  const form = prefilledDraftForm(idea);
  const name = edits.name ?? form.name;
  const note = edits.note ?? form.note;
  const problem = validateName(name, [], DRAFT_NAME_MAX);
  const noteProblem = note.length > DRAFT_NOTE_MAX;
  const base = baseSize(sizes);
  const block = ideaDraftBlock(idea);
  const existing = idea.draft;

  function openDraft(existingId: string) {
    router.replace({ pathname: "/projects/[id]/drafts/[draftId]", params: { id: projectId, draftId: existingId } });
  }

  async function submit() {
    if (inFlight.current || block) return;
    setSubmitted(true);
    setError(null);
    if (problem || noteProblem) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new ApiError("not_signed_in", 401);
      const result = await createDraftFromIdea(token, projectId, ideaId, { id: draftId, name: name.trim(), sizes, note: note.trim() });
      await addServerDraft(projectId, result.draft).catch(() => undefined);
      // The idea now links to the draft; fetch it so the idea screen shows the link before we leave this one.
      await refreshIdeas(projectId).catch(() => undefined);
      router.replace({
        pathname: "/projects/[id]/drafts/[draftId]",
        params: {
          id: projectId,
          draftId: result.draft.id,
          ...(result.photosNotCopied > 0 ? { photosNotCopied: String(result.photosNotCopied) } : {}),
        },
      });
    } catch (e) {
      setError(createDraftErrorKey(e));
      // Someone else made the draft first: learn which one, so the form can offer to open it.
      if (e instanceof ApiError && e.code === "idea_already_has_draft") await refreshIdeas(projectId).catch(() => undefined);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const message = existing
    ? t("ideas.createDraft.alreadyHasDraftNamed", { name: existing.name })
    : block
      ? t(block)
      : error
        ? t(error)
        : null;

  return (
    <Screen
      edges={[]}
      keyboardOffset={headerHeight}
      footer={<Button label={t("ideas.createDraft.button")} loading={busy} disabled={block !== null} onPress={submit} />}
    >
      <View style={{ gap: spacing[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
          <Ionicons name="bulb-outline" size={iconSize.sm} color={colors.textSecondary} />
          <Text style={[typography.label, { flex: 1, color: colors.textSecondary }]}>
            {form.photoCount > 0
              ? t("ideas.createDraft.fromLinePhotos", { title: form.ideaTitle, count: form.photoCount })
              : t("ideas.createDraft.fromLine", { title: form.ideaTitle })}
          </Text>
        </View>
        <TextField
          label={t("drafts.nameLabel")}
          icon="cafe-outline"
          placeholder={t("drafts.namePlaceholder")}
          value={name}
          onChangeText={(v) => setEdits((e) => ({ ...e, name: v }))}
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
          onChangeText={(v) => setEdits((e) => ({ ...e, note: v }))}
          error={submitted && noteProblem ? t("drafts.errors.noteTooLong") : null}
        />
        {message ? <ErrorText message={message} /> : null}
        {existing ? (
          <Text accessibilityRole="link" onPress={() => openDraft(existing.id)} style={[typography.label, { color: colors.accentStrong }]}>
            {t("ideas.createDraft.openDraft")}
          </Text>
        ) : null}
        {block ? <Hint>{t("ideas.createDraft.disabledReason")}</Hint> : null}
      </View>
    </Screen>
  );
}
