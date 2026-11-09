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
  deleteLanguagePendingSync,
  deleteToken,
  getLanguageChoice,
  getLanguagePendingSync,
  getToken,
  saveLanguageChoice,
  saveLanguagePendingSync,
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
  /** True while the local language choice has not reached the account yet. */
  languagePendingSync: boolean;
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
  const [languagePendingSync, setPendingSync] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const endSession = useCallback(async () => {
    tokenRef.current = null;
    setUser(null);
    setPendingSync(false);
    setStatus("signedOut");
    // The next person sees the phone's language, not this account's choice (R23).
    try {
      await applyLanguage(resolveLanguage(null));
    } catch {
      // Keep whatever language is showing.
    }
    for (const clear of [deleteToken, deleteLanguageChoice, deleteLanguagePendingSync]) {
      try {
        await clear();
      } catch {
        // Storage failure: the in-memory session is already gone.
      }
    }
  }, []);

  /** Sends the local choice to the account; keeps the pending flag unless it succeeds. */
  const flushPendingLanguage = useCallback(
    async (token: string) => {
      try {
        const choice = await getLanguageChoice();
        if (choice === null) {
          await deleteLanguagePendingSync();
          setPendingSync(false);
          return;
        }
        await updateLanguage(token, choice);
        if (tokenRef.current !== token) return;
        await deleteLanguagePendingSync();
        setPendingSync(false);
        setUser((current) => (current ? { ...current, language: choice } : current));
      } catch (error) {
        if (error instanceof ApiError && error.code === "not_signed_in") await endSession();
        // network or other errors: keep the flag and retry next time.
      }
    },
    [endSession],
  );

  /** Account language wins unless a local choice is still waiting to sync. */
  const reconcileLanguage = useCallback(
    async (token: string, accountLanguage: Language | null) => {
      let pending = false;
      try {
        pending = await getLanguagePendingSync();
      } catch {
        // Unreadable flag: treat as not pending.
      }
      if (pending) {
        setPendingSync(true);
        await flushPendingLanguage(token);
      } else {
        await syncLanguage(accountLanguage);
      }
    },
    [flushPendingLanguage],
  );

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
        await reconcileLanguage(token, me.language);
      } catch (error) {
        if (cancelled || tokenRef.current !== token) return;
        if (error instanceof ApiError && error.code === "not_signed_in") await endSession();
        // network or other errors: stay signed in.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endSession, reconcileLanguage]);

  const startSession = useCallback(async ({ token, user: me }: AuthResult) => {
    await saveToken(token);
    tokenRef.current = token;
    setUser(me);
    setStatus("signedIn");
    await reconcileLanguage(token, me.language);
  }, [reconcileLanguage]);

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
      try {
        await saveLanguageChoice(language);
      } catch {
        // Storage failure: the choice stays applied in memory.
      }
      setUser((current) => (current ? { ...current, language } : current));
      const token = tokenRef.current;
      if (!token) return;
      // Mark first so a crash or failed request never lets the account value win.
      try {
        await saveLanguagePendingSync();
      } catch {
        // Storage failure: the request below may still succeed.
      }
      setPendingSync(true);
      try {
        await updateLanguage(token, language);
        if (tokenRef.current !== token) return;
        await deleteLanguagePendingSync();
        setPendingSync(false);
      } catch (error) {
        if (error instanceof ApiError && error.code === "not_signed_in") await endSession();
        // network or other errors: keep the local choice and the pending flag.
      }
    },
    [endSession],
  );

  const value = useMemo(
    () => ({ status, user, signIn, signUp, signOut, setLanguage, languagePendingSync }),
    [status, user, signIn, signUp, signOut, setLanguage, languagePendingSync],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
