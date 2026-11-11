import * as SecureStore from "expo-secure-store";
import { File, Paths } from "expo-file-system";

import type { Language } from "../i18n";

const TOKEN_KEY = "session_token";
const LANGUAGE_KEY = "language_choice";

export const getToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const saveToken = (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token);
export const deleteToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);

// The id of the person the token belongs to, so an offline launch can tell whose copy of the
// projects is on the phone before the profile is fetched.
const USER_ID_KEY = "session_user_id";
export const getStoredUserId = () => SecureStore.getItemAsync(USER_ID_KEY);
export const saveStoredUserId = (id: string) => SecureStore.setItemAsync(USER_ID_KEY, id);
export const deleteStoredUserId = () => SecureStore.deleteItemAsync(USER_ID_KEY);

export async function getLanguageChoice(): Promise<Language | null> {
  const value = await SecureStore.getItemAsync(LANGUAGE_KEY);
  return value === "vi" || value === "en" ? value : null;
}
export const saveLanguageChoice = (lang: Language) =>
  SecureStore.setItemAsync(LANGUAGE_KEY, lang);
export const deleteLanguageChoice = () => SecureStore.deleteItemAsync(LANGUAGE_KEY);

const PENDING_KEY = "language_pending_sync";
export async function getLanguagePendingSync(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PENDING_KEY)) === "1";
}
export const saveLanguagePendingSync = () => SecureStore.setItemAsync(PENDING_KEY, "1");
export const deleteLanguagePendingSync = () => SecureStore.deleteItemAsync(PENDING_KEY);

// iOS keeps Keychain items after the app is deleted. A marker file in the document
// directory is removed with the app, so a missing marker means a fresh install and any
// Keychain leftovers (token, language, pending flag) must go before they are read.
export async function clearKeychainOnFreshInstall(): Promise<void> {
  const marker = new File(Paths.document, "launched.marker");
  if (marker.exists) return;
  await Promise.all([deleteToken(), deleteStoredUserId(), deleteLanguageChoice(), deleteLanguagePendingSync()]);
  marker.create();
}
