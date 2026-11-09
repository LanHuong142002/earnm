import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ApiError,
  getMe,
  signIn as apiSignIn,
  signOut as apiSignOut,
  signUp as apiSignUp,
  updateLanguage,
  type AuthResult,
  type User,
} from "../lib/api";
import { applyLanguage, resolveLanguage, type Language } from "../i18n";
import {
  deleteLanguageChoice,
  deleteToken,
  getLanguageChoice,
  getToken,
  saveLanguageChoice,
  saveToken,
} from "./token-store";

export type AuthStatus = "loading" | "signedIn" | "signedOut";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

/** Applies the account's language (or the phone's when unset) and syncs the local choice. */
async function syncLanguage(accountLanguage: Language | null): Promise<void> {
  if (accountLanguage === null) await deleteLanguageChoice();
  else await saveLanguageChoice(accountLanguage);
  await applyLanguage(resolveLanguage(accountLanguage));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const tokenRef = useRef<string | null>(null);

  const endSession = useCallback(async () => {
    tokenRef.current = null;
    setUser(null);
    setStatus("signedOut");
    try {
      await deleteToken();
    } catch {
      // Storage failure: the in-memory session is already gone.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let token: string | null = null;
      try {
        const choice = await getLanguageChoice();
        await applyLanguage(resolveLanguage(choice));
        token = await getToken();
      } catch {
        // Storage unavailable: fall through to signed out.
      }
      if (cancelled) return;
      if (!token) {
        setStatus("signedOut");
        return;
      }
      tokenRef.current = token;
      setStatus("signedIn");
      try {
        const me = await getMe(token);
        if (cancelled || tokenRef.current !== token) return;
        setUser(me);
        await syncLanguage(me.language);
      } catch (error) {
        if (cancelled || tokenRef.current !== token) return;
        if (error instanceof ApiError && error.code === "not_signed_in") await endSession();
        // network or other errors: stay signed in.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endSession]);

  const startSession = useCallback(async ({ token, user: me }: AuthResult) => {
    await saveToken(token);
    tokenRef.current = token;
    await syncLanguage(me.language);
    setUser(me);
    setStatus("signedIn");
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await startSession(await apiSignIn(email, password));
    },
    [startSession],
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      await startSession(await apiSignUp(email, password, displayName));
    },
    [startSession],
  );

  const signOut = useCallback(async () => {
    const token = tokenRef.current;
    if (token) {
      try {
        await apiSignOut(token);
      } catch {
        // Ignored: the phone forgets the session either way.
      }
    }
    await endSession();
  }, [endSession]);

  const setLanguage = useCallback(
    async (language: Language) => {
      await applyLanguage(language);
      await saveLanguageChoice(language);
      setUser((current) => (current ? { ...current, language } : current));
      const token = tokenRef.current;
      if (!token) return;
      try {
        await updateLanguage(token, language);
      } catch (error) {
        if (error instanceof ApiError && error.code === "not_signed_in") await endSession();
        // network or other errors: keep the local choice.
      }
    },
    [endSession],
  );

  const value = useMemo(
    () => ({ status, user, signIn, signUp, signOut, setLanguage }),
    [status, user, signIn, signUp, signOut, setLanguage],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
