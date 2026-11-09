import type { Language } from "../i18n";

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

type RequestOptions = { method?: string; body?: unknown; token?: string | null };

export async function request<T>(
  path: string,
  { method = "GET", body, token }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${process.env.EXPO_PUBLIC_API_URL ?? ""}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network");
  }

  if (!response.ok) {
    let code = "internal_error";
    let serverMessage: string | null = null;
    try {
      const data = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
      if (typeof data?.error?.code === "string") code = data.error.code;
      if (typeof data?.error?.message === "string") serverMessage = data.error.message;
    } catch {
      // Non-JSON error body: keep the fallback code.
    }
    throw new ApiError(code, response.status, serverMessage);
  }

  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("internal_error", response.status);
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
