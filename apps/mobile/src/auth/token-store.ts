import * as SecureStore from "expo-secure-store";

import type { Language } from "../i18n";

const TOKEN_KEY = "session_token";
const LANGUAGE_KEY = "language_choice";

export const getToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const saveToken = (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token);
export const deleteToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);

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
