import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { getToken } from "../../../../auth/token-store";
import { joinProject } from "../../../../lib/api";
import { memberErrorKey } from "../../../../members/errors";
import { joinCodeState } from "../../../../members/joinCode";
import { useProjects } from "../../../../projects/ProjectsProvider";
import { useTheme } from "../../../../theme/useTheme";
import { Button } from "../../../../ui/Button";
import { Enter } from "../../../../ui/Enter";
import { Screen } from "../../../../ui/Screen";
import { TextField } from "../../../../ui/TextField";

export default function JoinScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  // The Home stack header sits above this screen; the keyboard overlap must account for it.
  const headerHeight = useHeaderHeight();
  const { refresh, setCurrentProject } = useProjects();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const { normalized, canSubmit } = joinCodeState(code);

  async function submit() {
    if (inFlight.current || !normalized) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("no token");
      const project = await joinProject(token, normalized);
      await refresh();
      await setCurrentProject(project.id);
      // Replace this screen: Join was pushed from the Project list, so back from the project reaches the list.
      router.replace({ pathname: "/projects/[id]", params: { id: project.id } });
    } catch (e) {
      setError(t(memberErrorKey(e)));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen
      edges={[]}
      keyboardOffset={headerHeight}
      footer={<Button label={t("join.submit")} loading={busy} disabled={!canSubmit} onPress={() => void submit()} />}
    >
      <Enter index={0}>
        <View style={{ gap: spacing[2] }}>
          <TextField
            label={t("join.codeLabel")}
            icon="key-outline"
            placeholder={t("join.placeholder")}
            error={error}
            value={code}
            onChangeText={(text) => {
              setCode(text);
              setError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="go"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => void submit()}
            editable={!busy}
          />
        </View>
      </Enter>
    </Screen>
  );
}
