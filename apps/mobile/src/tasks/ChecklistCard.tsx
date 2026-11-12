import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import { motion } from "../theme/tokens";
import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { PressableScale } from "../ui/PressableScale";
import { barPercent, canAddItem, editItemOutcome, newItemOutcome } from "./checklistView";
import { confirmDeleteChecklist, showChecklistMenu } from "./ChecklistMenu";
import { InlineInput } from "./InlineInput";
import { checklistProgress } from "./progress";
import { useTasks } from "./TasksProvider";
import type { Checklist, ChecklistItem } from "./types";
import { validateChecklistName } from "./validate";

/** The 4px bar: accent on field. Its width animates over motion.progress; Reduce Motion jumps. */
function ProgressBar({ percent }: { percent: number }) {
  const { colors, radius } = useTheme();
  const reduced = useReducedMotion();
  const width = useSharedValue(percent);
  useEffect(() => {
    width.value = reduced ? percent : withTiming(percent, { duration: motion.progress.duration });
  }, [percent, reduced, width]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 4, borderRadius: radius.pill, backgroundColor: colors.field, overflow: "hidden" }}
    >
      <Animated.View style={[{ height: "100%", borderRadius: radius.pill, backgroundColor: colors.accent }, fill]} />
    </View>
  );
}

function ItemRow({
  projectId,
  taskId,
  checklistId,
  item,
  first,
}: {
  projectId: string;
  taskId: string;
  checklistId: string;
  item: ChecklistItem;
  first: boolean;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing, layout, iconSize } = useTheme();
  const { toggleItem, editItem, deleteItem } = useTasks();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [error, setError] = useState<string | null>(null);
  // Return and the blur it may cause must save once.
  const settled = useRef(false);

  function begin() {
    settled.current = false;
    setDraft(item.text);
    setError(null);
    setEditing(true);
  }

  async function commit(source: "submit" | "blur") {
    if (settled.current) return;
    const outcome = editItemOutcome(item.text, draft, source);
    if (outcome.kind === "error") {
      setError(outcome.error);
      return;
    }
    settled.current = true;
    if (outcome.kind === "save") {
      const result = await editItem(projectId, taskId, checklistId, item.id, outcome.text);
      if (!result.ok) {
        settled.current = false;
        setError(result.error);
        return;
      }
    }
    setEditing(false);
  }

  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: colors.border }}>
      <View style={{ minHeight: layout.controlHeight, flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
        <PressableScale
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.done }}
          accessibilityLabel={item.text}
          onPress={() => void toggleItem(projectId, taskId, checklistId, item.id)}
          // The visible box is 20px; the touch area is the full row height.
          style={{ width: layout.controlHeight, height: layout.controlHeight, justifyContent: "center" }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: radius.checkbox,
              borderWidth: 1.5,
              borderColor: item.done ? colors.accent : colors.placeholder,
              backgroundColor: item.done ? colors.accent : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {item.done ? <Ionicons name="checkmark" size={14} color={colors.onAccent} /> : null}
          </View>
        </PressableScale>
        {editing ? (
          <>
            <InlineInput
              value={draft}
              onChangeText={(v) => {
                setDraft(v);
                setError(null);
              }}
              onSubmit={() => void commit("submit")}
              onBlur={() => void commit("blur")}
              accessibilityLabel={t("tasks.checklists.itemEditA11y", { text: item.text })}
              invalid={error !== null}
            />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t("tasks.checklists.itemDeleteA11y", { text: item.text })}
              onPress={() => {
                settled.current = true;
                void deleteItem(projectId, taskId, checklistId, item.id);
              }}
              style={{ width: layout.controlHeight, height: layout.controlHeight, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="close" size={iconSize.md} color={colors.danger} />
            </PressableScale>
          </>
        ) : (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("tasks.checklists.itemEditA11y", { text: item.text })}
            onPress={begin}
            style={{ flex: 1, minHeight: layout.controlHeight, justifyContent: "center" }}
          >
            <Text
              style={[
                typography.body,
                item.done ? { color: colors.textSecondary, textDecorationLine: "line-through" } : { color: colors.text },
              ]}
            >
              {item.text}
            </Text>
          </PressableScale>
        )}
      </View>
      {error ? (
        <View style={{ paddingBottom: spacing[0] }}>
          <ErrorText message={t(error)} />
        </View>
      ) : null}
    </View>
  );
}

function AddItem({
  projectId,
  taskId,
  checklist,
  open,
  setOpen,
}: {
  projectId: string;
  taskId: string;
  checklist: Checklist;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, spacing } = useTheme();
  const { addItem } = useTasks();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const full = !canAddItem(checklist.items.length);

  async function commit(source: "submit" | "blur") {
    if (busy.current) return;
    const outcome = newItemOutcome(draft, source);
    if (outcome.kind === "close") {
      setError(null);
      setOpen(false);
      return;
    }
    if (outcome.kind === "error") {
      setError(outcome.error);
      return;
    }
    if (outcome.kind !== "add") return;
    busy.current = true;
    try {
      const result = await addItem(projectId, taskId, checklist.id, outcome.text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft("");
      setError(null);
      // Return stays open and focused for the next item; a blur-add closes.
      if (!outcome.keepOpen) setOpen(false);
    } finally {
      busy.current = false;
    }
  }

  const divider = { borderTopWidth: 1, borderTopColor: colors.border } as const;
  if (full) {
    return (
      <View style={[{ minHeight: layout.controlHeight, justifyContent: "center" }, divider]}>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("tasks.checklists.itemLimit")}</Text>
      </View>
    );
  }
  if (!open) {
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t("tasks.checklists.addItemA11y", { name: checklist.name })}
        onPress={() => setOpen(true)}
        style={[{ minHeight: layout.controlHeight, justifyContent: "center" }, divider]}
      >
        <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("tasks.checklists.addItem")}</Text>
      </PressableScale>
    );
  }
  return (
    <View style={[{ gap: spacing[0], paddingTop: spacing[0], paddingBottom: spacing[1] }, divider]}>
      <View style={{ flexDirection: "row" }}>
        <InlineInput
          value={draft}
          onChangeText={(v) => {
            setDraft(v);
            setError(null);
          }}
          onSubmit={() => void commit("submit")}
          onBlur={() => void commit("blur")}
          accessibilityLabel={t("tasks.checklists.newItemA11y", { name: checklist.name })}
          placeholder={t("tasks.checklists.newItemPlaceholder")}
          invalid={error !== null}
        />
      </View>
      {error ? <ErrorText message={t(error)} /> : null}
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("tasks.checklists.itemHint")}</Text>
    </View>
  );
}

/** One checklist as a card: name, its own progress, the ⋯ menu, a bar, the items and "Add item" (mockups 2a to 2d). */
export function ChecklistCard({
  projectId,
  taskId,
  checklist,
  autoAddItem = false,
}: {
  projectId: string;
  taskId: string;
  checklist: Checklist;
  /** True for a checklist just created, so its "add item" input opens at once (mockup 2f). */
  autoAddItem?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, layout, iconSize } = useTheme();
  const { renameChecklist, deleteChecklist } = useTasks();
  const progress = checklistProgress(checklist);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(checklist.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const settled = useRef(false);

  // Opens when told to, even if the card appeared a moment before the flag.
  const [sawAuto, setSawAuto] = useState(false);
  if (autoAddItem !== sawAuto) {
    setSawAuto(autoAddItem);
    if (autoAddItem) setAdding(true);
  }

  function beginRename() {
    settled.current = false;
    setName(checklist.name);
    setNameError(null);
    setRenaming(true);
  }

  async function commitRename(source: "submit" | "blur") {
    if (settled.current) return;
    const checked = validateChecklistName(name);
    if (!checked.ok) {
      // Blur with nothing valid keeps the old name; Return says why.
      if (source === "blur") {
        settled.current = true;
        setRenaming(false);
      } else setNameError(checked.error);
      return;
    }
    settled.current = true;
    if (checked.value !== checklist.name) {
      const result = await renameChecklist(projectId, taskId, checklist.id, checked.value);
      if (!result.ok) {
        settled.current = false;
        setNameError(result.error);
        return;
      }
    }
    setRenaming(false);
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1], minHeight: layout.controlHeight }}>
        {renaming ? (
          <InlineInput
            value={name}
            onChangeText={(v) => {
              setName(v);
              setNameError(null);
            }}
            onSubmit={() => void commitRename("submit")}
            onBlur={() => void commitRename("blur")}
            accessibilityLabel={t("tasks.checklists.renameA11y")}
            invalid={nameError !== null}
          />
        ) : (
          <Text accessibilityRole="header" style={[typography.bodyStrong, { flex: 1, color: colors.text }]}>
            {checklist.name}
          </Text>
        )}
        {progress ? (
          <Text
            accessibilityLabel={t("tasks.checklists.progressA11y", {
              name: checklist.name,
              done: progress.done,
              total: progress.total,
            })}
            style={[typography.caption, { color: colors.textSecondary, fontFamily: typography.label.fontFamily }]}
          >
            {progress.done}/{progress.total}
          </Text>
        ) : null}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("tasks.checklists.optionsA11y", { name: checklist.name })}
          onPress={() =>
            showChecklistMenu(t, checklist.name, beginRename, () =>
              confirmDeleteChecklist(t, checklist.name, checklist.items.length, () => {
                void deleteChecklist(projectId, taskId, checklist.id);
              }),
            )
          }
          // Pulled in so the dots line up with the card's padding.
          style={{
            width: layout.controlHeight,
            height: layout.controlHeight,
            alignItems: "center",
            justifyContent: "center",
            marginRight: -spacing[1],
          }}
        >
          <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={colors.textSecondary} />
        </PressableScale>
      </View>
      {nameError ? <ErrorText message={t(nameError)} /> : null}
      <ProgressBar percent={barPercent(progress)} />
      <View style={{ marginTop: spacing[0] }}>
        {checklist.items.map((item, i) => (
          <ItemRow key={item.id} projectId={projectId} taskId={taskId} checklistId={checklist.id} item={item} first={i === 0} />
        ))}
        <AddItem projectId={projectId} taskId={taskId} checklist={checklist} open={adding} setOpen={setAdding} />
      </View>
    </Card>
  );
}
