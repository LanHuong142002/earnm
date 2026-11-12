import type { Language } from "../i18n";
import type { Project as ApiProject } from "../projects/api";

export type User = {
  id: string;
  email: string;
  displayName: string;
  language: Language | null;
};

export type AuthResult = { token: string; user: User };

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** The server's human-readable message, when it sent one (used to find invalid fields). */
  readonly serverMessage: string | null;

  constructor(code: string, status = 0, serverMessage: string | null = null) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

type RequestOptions = { method?: string; body?: unknown; token?: string | null };

export async function request<T>(
  path: string,
  { method = "GET", body, token }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // The timer stays armed until the body has been read, so a stalled body cannot hang.
  try {
    let response: Response;
    try {
      response = await fetch(`${process.env.EXPO_PUBLIC_API_URL ?? ""}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError("network");
    }

    if (!response.ok) {
      let text: string;
      try {
        text = await response.text();
      } catch {
        throw new ApiError("network");
      }
      let code = "internal_error";
      let serverMessage: string | null = null;
      try {
        const data = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
        if (typeof data?.error?.code === "string") code = data.error.code;
        if (typeof data?.error?.message === "string") serverMessage = data.error.message;
      } catch {
        // Non-JSON error body: keep the fallback code.
      }
      throw new ApiError(code, response.status, serverMessage);
    }

    if (response.status === 204) return undefined as T;
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new ApiError("network");
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError("internal_error", response.status);
    }
  } finally {
    clearTimeout(timer);
  }
}

export const signUp = (email: string, password: string, displayName: string) =>
  request<AuthResult>("/auth/sign-up", {
    method: "POST",
    body: { email, password, displayName },
  });

export const signIn = (email: string, password: string) =>
  request<AuthResult>("/auth/sign-in", { method: "POST", body: { email, password } });

export const signOut = (token: string) =>
  request<void>("/auth/sign-out", { method: "POST", token });

export const getMe = (token: string) => request<User>("/me", { token });

export const updateLanguage = (token: string, language: Language) =>
  request<User>("/me", { method: "PATCH", body: { language }, token });

export type MemberRole = "owner" | "member";

export type Member = {
  userId: string;
  displayName: string;
  role: MemberRole;
  joinedAt: string;
};

export type CreatedInvite = { id: string; code: string; expiresAt: string };

export type PendingInvite = {
  id: string;
  createdBy: { displayName: string } | null;
  createdAt: string;
  expiresAt: string;
};

const projectPath = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;

export const createInvite = (token: string, projectId: string) =>
  request<CreatedInvite>(`${projectPath(projectId)}/invites`, { method: "POST", token });

export const listInvites = (token: string, projectId: string) =>
  request<PendingInvite[]>(`${projectPath(projectId)}/invites`, { token });

export const revokeInvite = (token: string, projectId: string, inviteId: string) =>
  request<void>(`${projectPath(projectId)}/invites/${encodeURIComponent(inviteId)}`, {
    method: "DELETE",
    token,
  });

export const joinProject = (token: string, code: string) =>
  request<ApiProject>("/invites/join", { method: "POST", body: { code }, token });

export const listMembers = (token: string, projectId: string) =>
  request<Member[]>(`${projectPath(projectId)}/members`, { token });

export const setMemberRole = (
  token: string,
  projectId: string,
  userId: string,
  role: MemberRole,
) =>
  request<Member>(`${projectPath(projectId)}/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: { role },
    token,
  });

export const removeMember = (token: string, projectId: string, userId: string) =>
  request<void>(`${projectPath(projectId)}/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    token,
  });

export const leaveProject = (token: string, projectId: string) =>
  request<void>(`${projectPath(projectId)}/leave`, { method: "POST", token });
