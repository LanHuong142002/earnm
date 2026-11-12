import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Share, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../../../../auth/AuthProvider";
import { getToken } from "../../../../../auth/token-store";
import {
  createInvite,
  leaveProject,
  listInvites,
  removeMember,
  revokeInvite,
  setMemberRole,
  type Member,
  type PendingInvite,
} from "../../../../../lib/api";
import { initialOf } from "../../../../../members/avatarRow";
import { memberErrorKey } from "../../../../../members/errors";
import { formatExpiry, inviteLink, rowModel, viewerRole } from "../../../../../members/screenModel";
import { useMembers } from "../../../../../members/useMembers";
import { OfflineNote } from "../../../../../projects/OfflineNote";
import { useProjects } from "../../../../../projects/ProjectsProvider";
import { projectView } from "../../../../../projects/routing";
import { useGoToProjectList } from "../../../../../projects/useProjectNav";
import { useTheme } from "../../../../../theme/useTheme";
import { Avatar } from "../../../../../ui/Avatar";
import { Button } from "../../../../../ui/Button";
import { Card } from "../../../../../ui/Card";
import { Collapsible } from "../../../../../ui/Collapsible";
import { Enter } from "../../../../../ui/Enter";
import { PressableScale } from "../../../../../ui/PressableScale";
import { Screen } from "../../../../../ui/Screen";

export default function MembersScreen() {
  const { t, i18n } = useTranslation();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const { colors, typography, spacing, layout, iconSize, radius } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();
  const { status, projects, refresh: refreshProjects } = useProjects();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const { members, status: membersStatus, refresh } = useMembers(id, focused);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [leaving, setLeaving] = useState(false);

  const userId = user?.id ?? null;
  const role = viewerRole(members, userId, project?.role ?? null);
  const isOwner = role === "owner";

  // Unknown or vanished project: back to the list. Not while leaving, which navigates itself.
  useEffect(() => {
    if (view === "leave" && focused && !leaving) goToList();
  }, [view, focused, leaving, goToList]);

  // Resolves to null on any failure: the pending list is a convenience, keep what is shown.
  const fetchInvites = useCallback(async (): Promise<PendingInvite[] | null> => {
    try {
      const token = await getToken();
      return token ? await listInvites(token, id) : null;
    } catch {
      return null;
    }
  }, [id]);

  const loadInvites = useCallback(async () => {
    const list = await fetchInvites();
    if (list) setInvites(list);
  }, [fetchInvites]);

  useEffect(() => {
    if (!isOwner || !focused) return;
    let cancelled = false;
    void fetchInvites().then((list) => {
      if (!cancelled && list) setInvites(list);
    });
    return () => {
      cancelled = true;
    };
  }, [isOwner, focused, fetchInvites]);

  // One action at a time; a failure is shown as an alert and nothing is queued.
  const run = useCallback(
    async (name: string, action: (token: string) => Promise<void>, memberCount?: number) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(name);
      try {
        const token = await getToken();
        if (!token) return;
        await action(token);
      } catch (error) {
        Alert.alert(t(memberErrorKey(error, { memberCount })));
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [t],
  );

  function invite() {
    void run("invite", async (token) => {
      const created = await createInvite(token, id);
      const message = t("invites.shareMessage", {
        inviter: profile?.displayName ?? user?.displayName ?? "",
        project: project?.name ?? "",
        code: created.code,
        link: inviteLink(process.env.EXPO_PUBLIC_API_URL, created.code),
      });
      await loadInvites();
      await Share.share({ message });
    });
  }

  // A self-demote or removal can change the viewer's own role in the projects list.
  async function afterMemberChange() {
    await Promise.all([refresh(), refreshProjects()]);
  }

  function openActions(member: Member, toggleTo: "owner" | "member") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [t(toggleTo === "owner" ? "members.makeOwner" : "members.makeMember"), t("members.remove"), t("common.cancel")],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) {
          void run(`role:${member.userId}`, async (token) => {
            await setMemberRole(token, id, member.userId, toggleTo);
            await afterMemberChange();
          });
        } else if (index === 1) {
          Alert.alert(
            t("members.removeConfirmTitle", { name: member.displayName }),
            t("members.removeConfirmMessage", { name: member.displayName }),
            [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("members.remove"),
                style: "destructive",
                onPress: () =>
                  void run(`remove:${member.userId}`, async (token) => {
                    await removeMember(token, id, member.userId);
                    await afterMemberChange();
                  }),
              },
            ],
          );
        }
      },
    );
  }

  function confirmRevoke(inv: PendingInvite) {
    Alert.alert(t("invites.revokeConfirmTitle"), t("invites.revokeConfirmMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("invites.revoke"),
        style: "destructive",
        onPress: () =>
          void run(`revoke:${inv.id}`, async (token) => {
            await revokeInvite(token, id, inv.id);
            await loadInvites();
          }),
      },
    ]);
  }

  function confirmLeave() {
    Alert.alert(t("members.leaveConfirmTitle"), t("members.leaveConfirmMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("members.leave"),
        style: "destructive",
        onPress: () =>
          void run(
            "leave",
            async (token) => {
              setLeaving(true);
              try {
                await leaveProject(token, id);
              } catch (error) {
                setLeaving(false);
                throw error;
              }
              await refreshProjects().catch(() => {});
              goToList();
            },
            members?.length,
          ),
      },
    ]);
  }

  if (!members) {
    return (
      <Screen edges={[]}>
        <OfflineNote />
        {membersStatus === "offline" ? (
          <View style={{ gap: spacing[2], alignItems: "flex-start" }}>
            <Text style={[typography.body, { color: colors.textSecondary }]}>{t("members.loadError")}</Text>
            <Button label={t("members.retry")} variant="secondary" onPress={() => void refresh()} />
          </View>
        ) : (
          <ActivityIndicator accessibilityLabel={t("common.loading")} color={colors.textSecondary} />
        )}
      </Screen>
    );
  }

  const inviting = busy === "invite";

  return (
    <Screen edges={[]}>
      <OfflineNote />
      {isOwner ? (
        <Enter index={0}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("invites.invite")}
            accessibilityState={{ disabled: inviting, busy: inviting }}
            disabled={inviting}
            onPress={invite}
            style={{
              minHeight: layout.controlHeight,
              borderRadius: radius.button,
              backgroundColor: colors.accentStrong,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing[1],
              paddingHorizontal: spacing[3],
            }}
          >
            {inviting ? (
              <ActivityIndicator accessibilityLabel={t("common.loading")} color={colors.onAccent} />
            ) : (
              <>
                <Ionicons name="share-outline" size={iconSize.sm} color={colors.onAccent} />
                <Text style={[typography.bodyStrong, { color: colors.onAccent }]}>{t("invites.invite")}</Text>
              </>
            )}
          </PressableScale>
        </Enter>
      ) : null}

      <Enter index={1}>
        <Card>
          <View style={{ gap: spacing[1] }}>
            {members.map((member) => {
              const row = rowModel(member, userId, role);
              return (
                <View
                  key={member.userId}
                  style={{ flexDirection: "row", alignItems: "center", gap: spacing[2], minHeight: layout.controlHeight }}
                >
                  <Avatar letter={initialOf(member.displayName)} />
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyStrong, { color: colors.text }]}>
                      {member.displayName}
                      {row.isViewer ? (
                        <Text style={{ color: colors.textSecondary }}>{` ${t("members.you")}`}</Text>
                      ) : null}
                    </Text>
                    <Text style={[typography.caption, { color: colors.textSecondary }]}>
                      {t(`members.${member.role}`)}
                    </Text>
                  </View>
                  {row.canManage ? (
                    busy?.endsWith(`:${member.userId}`) ? (
                      <ActivityIndicator accessibilityLabel={t("common.loading")} color={colors.textSecondary} />
                    ) : (
                      <PressableScale
                        accessibilityRole="button"
                        accessibilityLabel={t("members.more", { name: member.displayName })}
                        onPress={() => openActions(member, row.toggleTo)}
                        style={{
                          width: layout.controlHeight,
                          height: layout.controlHeight,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={colors.textSecondary} />
                      </PressableScale>
                    )
                  ) : null}
                </View>
              );
            })}
          </View>
        </Card>
      </Enter>

      {isOwner ? (
        <Enter index={2}>
          <Collapsible title={t("invites.pending", { count: invites.length })}>
            <View style={{ gap: spacing[1] }}>
              {invites.map((inv) => (
                <View
                  key={inv.id}
                  style={{ flexDirection: "row", alignItems: "center", gap: spacing[2], minHeight: layout.controlHeight }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.body, { color: colors.text }]}>
                      {t("invites.createdBy", { name: inv.createdBy?.displayName ?? t("invites.unknownCreator") })}
                    </Text>
                    <Text style={[typography.caption, { color: colors.textSecondary }]}>
                      {t("invites.expires", { date: formatExpiry(inv.expiresAt, i18n.language) })}
                    </Text>
                  </View>
                  {busy === `revoke:${inv.id}` ? (
                    <ActivityIndicator accessibilityLabel={t("common.loading")} color={colors.textSecondary} />
                  ) : (
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={t("invites.revoke")}
                      onPress={() => confirmRevoke(inv)}
                      style={{ minHeight: layout.controlHeight, justifyContent: "center", paddingHorizontal: spacing[1] }}
                    >
                      <Text style={[typography.bodyStrong, { color: colors.danger }]}>{t("invites.revoke")}</Text>
                    </PressableScale>
                  )}
                </View>
              ))}
            </View>
          </Collapsible>
        </Enter>
      ) : null}

      <Enter index={3}>
        <Button label={t("members.leave")} variant="danger" loading={busy === "leave"} onPress={confirmLeave} />
      </Enter>
    </Screen>
  );
}
