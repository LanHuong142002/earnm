import type { Member, MemberRole } from "../lib/api";

/** The link shown in the share message. The API normalizes dashes and case in the code. */
export function inviteLink(apiBase: string | undefined, code: string): string {
  return `${(apiBase ?? "").replace(/\/+$/, "")}/i/${code}`;
}

/** The viewer's role from the member list, else the project's role, else the safer "member". */
export function viewerRole(
  members: Member[] | null,
  userId: string | null,
  projectRole: MemberRole | null,
): MemberRole {
  const mine = userId ? members?.find((m) => m.userId === userId) : undefined;
  return mine?.role ?? projectRole ?? "member";
}

export type RowModel = { isViewer: boolean; canManage: boolean; toggleTo: MemberRole };

/** What one member row offers: Owners manage everyone but themselves. */
export function rowModel(member: Member, viewerId: string | null, role: MemberRole): RowModel {
  const isViewer = member.userId === viewerId;
  return {
    isViewer,
    canManage: role === "owner" && !isViewer,
    toggleTo: member.role === "owner" ? "member" : "owner",
  };
}

/** dd/mm/yyyy in Vietnamese, the locale's own day-month-year order otherwise. */
export function formatExpiry(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export type MembersStatus = "loading" | "ready" | "offline" | "gone";
export type MembersBody = "list" | "loading" | "error" | "gone";

/** What the Members screen shows: the list, a wait, a retry, or nothing while it leaves a project that is gone. */
export function membersBody(members: Member[] | null, status: MembersStatus): MembersBody {
  if (status === "gone") return "gone";
  if (members) return "list";
  return status === "offline" ? "error" : "loading";
}
