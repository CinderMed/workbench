import i18next, { type i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

/** UI text goes only through i18next; English is the source locale (Italian is added as a translation). */
export function createI18n(): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}
