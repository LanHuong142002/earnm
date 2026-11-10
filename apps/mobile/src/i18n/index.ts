import { getLocales } from "expo-localization";
import i18next, { changeLanguage } from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./en.json";
import vi from "./vi.json";

export type Language = "vi" | "en";

/** The account's choice if set; otherwise Vietnamese for a Vietnamese device, else English. */
export function resolveLanguage(accountChoice: Language | null): Language {
  if (accountChoice !== null) return accountChoice;
  return getLocales()[0]?.languageCode === "vi" ? "vi" : "en";
}

export function applyLanguage(lang: Language): Promise<unknown> {
  return changeLanguage(lang);
}

if (!i18next.isInitialized) {
  // eslint-disable-next-line import/no-named-as-default-member -- plugin registration is only on the instance
  void i18next.use(initReactI18next).init({
    resources: { vi: { translation: vi }, en: { translation: en } },
    lng: resolveLanguage(null),
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
}

export default i18next;
