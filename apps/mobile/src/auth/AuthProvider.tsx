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
import { AppState } from "react-native";

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
import { asyncStorageStore } from "../sync/asyncStorageStore";
import { applyLanguage, resolveLanguage, type Language } from "../i18n";
import {
  clearKeychainOnFreshInstall,
  deleteLanguageChoice,
  deleteLanguagePendingSync,
  deleteStoredUserId,
  deleteToken,
  getLanguageChoice,
  getLanguagePendingSync,
  getStoredUserId,
  getToken,
  saveLanguageChoice,
  saveLanguagePendingSync,
  saveStoredUserId,
  saveToken,
} from "./token-store";
import { clearProfile, readProfile, visibleProfile, writeProfile, type Profile } from "./profile-store";

const MAX_FLUSH_ROUNDS = 3;

export type AuthStatus = "loading" | "signedIn" | "signedOut";
export type ProfileStatus = "loading" | "ready" | "offline";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  /** Name and email to show: the signed-in user, or the saved copy before the server answers. */
  profile: Profile | null;
  /** State of the background profile fetch at launch. */
  profileStatus: ProfileStatus;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
  /** Registers cleanup that runs before the user's own sign-out ends the session. Returns an unregister function. */
  registerSignOutCleanup: (cleanup: () => Promise<void>) => () => void;
  /** The server said "not signed in" (401): return to sign-in without clearing local data. */
  handleNotSignedIn: () => Promise<void>;
  /** True while the local language choice has not reached the account yet. */
  languagePendingSync: boolean;
  /**
   * Retries the profile fetch after an offline launch. Does nothing unless signed in with
   * profileStatus "offline"; one run at a time. Resolves true when the user is known afterwards.
   */
  retryProfile: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

function saveProfileCopy(me: User): Promise<void> {
  return writeProfile(asyncStorageStore, { userId: me.id, email: me.email, displayName: me.displayName }).catch(() => {});
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
  const [storedProfile, setStoredProfile] = useState<Profile | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>("loading");
  const [languagePendingSync, setPendingSync] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const flushingRef = useRef(false);
  const rerunRef = useRef(false);
  const flushRef = useRef<(token: string) => Promise<void>>(async () => {});
  const pendingRef = useRef(false);
  const profileStatusRef = useRef<ProfileStatus>("loading");
  const userKnownRef = useRef(false);
  const retryingRef = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    profileStatusRef.current = profileStatus;
    userKnownRef.current = user !== null;
  }, [profileStatus, user]);
  useEffect(() => {
    pendingRef.current = languagePendingSync;
  }, [languagePendingSync]);

  const signOutCleanupRef = useRef<(() => Promise<void>) | null>(null);

  const registerSignOutCleanup = useCallback((cleanup: () => Promise<void>) => {
    signOutCleanupRef.current = cleanup;
    return () => {
      if (signOutCleanupRef.current === cleanup) signOutCleanupRef.current = null;
    };
  }, []);

  const endSession = useCallback(async () => {
    tokenRef.current = null;
    rerunRef.current = false;
    setUser(null);
    setStoredProfile(null);
    setProfileStatus("loading");
    setPendingSync(false);
    setStatus("signedOut");
    // The next person sees the phone's language, not this account's choice (R23).
    try {
      await applyLanguage(resolveLanguage(null));
    } catch {
      // Keep whatever language is showing.
    }
    for (const clear of [deleteToken, deleteStoredUserId, () => clearProfile(asyncStorageStore), deleteLanguageChoice, deleteLanguagePendingSync]) {
      try {
        await clear();
      } catch {
        // Storage failure: the in-memory session is already gone.
      }
    }
  }, []);

  /**
   * The one path for language PATCHes. One run at a time; a call during a run only asks the
   * running one to go round again. Clears the pending flag only when the stored choice is
   * still what was sent.
   */
  const flushPendingLanguage = useCallback(
    async (token: string): Promise<void> => {
      if (flushingRef.current) {
        rerunRef.current = true;
        return;
      }
      flushingRef.current = true;
      try {
        for (let round = 0; round < MAX_FLUSH_ROUNDS; round += 1) {
          rerunRef.current = false;
          const choice = await getLanguageChoice();
          if (choice === null) {
            await deleteLanguagePendingSync();
            if (tokenRef.current === token) setPendingSync(false);
            return;
          }
          await updateLanguage(token, choice);
          if (tokenRef.current !== token) return;
          const latest = await getLanguageChoice();
          if (latest !== choice || rerunRef.current) continue;
          await deleteLanguagePendingSync();
          if (tokenRef.current !== token) return;
          if (rerunRef.current) {
            // A tap landed while the flag was being cleared: put it back and go again.
            try {
              await saveLanguagePendingSync();
            } catch {
              // Storage failure: the next round still sends the stored choice.
            }
            continue;
          }
          setPendingSync(false);
          setUser((current) => (current ? { ...current, language: choice } : current));
          return;
        }
        // Still changing after several rounds: keep the flag and retry next time.
      } catch (error) {
        if (tokenRef.current !== token) return;
        if (error instanceof ApiError && error.code === "not_signed_in") await endSession();
        // network or other errors: keep the flag and retry next time.
      } finally {
        flushingRef.current = false;
        // A request for another session arrived while this run was in flight and was
        // dropped when the token changed: serve it now for the current token.
        const current = tokenRef.current;
        if (current !== null && current !== token && rerunRef.current) {
          rerunRef.current = false;
          void flushRef.current(current);
        }
      }
    },
    [endSession],
  );
  useEffect(() => {
    flushRef.current = flushPendingLanguage;
  }, [flushPendingLanguage]);

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
        await clearKeychainOnFreshInstall();
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
        const storedId = await getStoredUserId();
        const saved = storedId ? await readProfile(asyncStorageStore, storedId) : null;
        // Only while the server has not answered; a known user always wins.
        if (!cancelled && tokenRef.current === token) setStoredProfile(saved);
      } catch {
        // No saved profile: the card stays hidden until getMe answers.
      }
      try {
        // Show the pending note even if the network call below fails.
        if (await getLanguagePendingSync()) setPendingSync(true);
      } catch {
        // Unreadable flag: treat as not pending.
      }
      setProfileStatus("loading");
      try {
        const me = await getMe(token);
        if (cancelled || tokenRef.current !== token) return;
        setUser(me);
        setProfileStatus("ready");
        void saveStoredUserId(me.id).catch(() => {});
        void saveProfileCopy(me);
        await reconcileLanguage(token, me.language);
      } catch (error) {
        if (cancelled || tokenRef.current !== token) return;
        if (error instanceof ApiError && error.code === "not_signed_in") await endSession();
        // Any other failure (network, 5xx while the host wakes): stay signed in and retry later.
        else setProfileStatus("offline");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endSession, reconcileLanguage]);

  const retryProfile = useCallback((): Promise<boolean> => {
    if (retryingRef.current) return retryingRef.current;
    const token = tokenRef.current;
    if (!token || profileStatusRef.current !== "offline") return Promise.resolve(userKnownRef.current);
    const run = (async () => {
      try {
        const me = await getMe(token);
        if (tokenRef.current !== token) return false;
        setUser(me);
        setProfileStatus("ready");
        void saveStoredUserId(me.id).catch(() => {});
        void saveProfileCopy(me);
        await reconcileLanguage(token, me.language);
        return true;
      } catch (error) {
        if (tokenRef.current !== token) return false;
        if (error instanceof ApiError && error.code === "not_signed_in") await endSession();
        // network or other errors: stay offline and try again at the next trigger.
        return false;
      } finally {
        retryingRef.current = null;
      }
    })();
    retryingRef.current = run;
    return run;
  }, [endSession, reconcileLanguage]);

  // On returning to the foreground: retry a pending language sync and an offline profile fetch.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const token = tokenRef.current;
      if (token && pendingRef.current) void flushPendingLanguage(token);
      void retryProfile();
    });
    return () => subscription.remove();
  }, [flushPendingLanguage, retryProfile]);

  const startSession =useCallback(async ({ token, user: me }: AuthResult) => {
    await saveToken(token);
    try {
      await saveStoredUserId(me.id);
    } catch {
      // Without it an offline launch shows no saved projects until the profile loads.
    }
    void saveProfileCopy(me);
    tokenRef.current = token;
    setUser(me);
    setStoredProfile(null);
    setProfileStatus("ready");
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
    // The user's own sign-out removes the local project copy and queue first (R28).
    try {
      await signOutCleanupRef.current?.();
    } catch {
      // Cleanup is best effort: the sign-out itself must still happen.
    }
    // Forget the session first so a slow or unreachable server cannot keep it alive (R20).
    await endSession();
    if (token) {
      // Fire and forget: the server call must never block or undo the sign-out.
      apiSignOut(token).catch(() => {});
    }
  }, [endSession]);

  const handleNotSignedIn = useCallback(() => endSession(), [endSession]);

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
      await flushPendingLanguage(token);
    },
    [flushPendingLanguage],
  );

  const profile = useMemo(() => visibleProfile(user, storedProfile), [user, storedProfile]);

  const value = useMemo(
    () => ({
      status,
      user,
      profile,
      profileStatus,
      signIn,
      signUp,
      signOut,
      setLanguage,
      languagePendingSync,
      registerSignOutCleanup,
      handleNotSignedIn,
      retryProfile,
    }),
    [
      status,
      user,
      profile,
      profileStatus,
      signIn,
      signUp,
      signOut,
      setLanguage,
      languagePendingSync,
      registerSignOutCleanup,
      handleNotSignedIn,
      retryProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
