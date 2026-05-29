import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import tr from "./locales/tr.json";
import en from "./locales/en.json";

// Audit 9.4 — eksik key'de UI'da çıplak key string'i ("home.title" gibi)
// görünmesin. Dev'de console.warn ile geliştirici uyarılır; prod'da
// boş string döner (fallback dile zaten otomatik düşer).
const isDev = import.meta.env.DEV;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      tr: { translation: tr },
      en: { translation: en },
    },
    fallbackLng: "tr",
    supportedLngs: ["tr", "en"],
    interpolation: { escapeValue: false },
    returnNull: false,
    parseMissingKeyHandler: (key) => {
      if (isDev) console.warn(`[i18n] missing key: ${key}`);
      return key.split(".").pop() ?? key; // son segment (UI'da daha az çirkin)
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "lang",
      caches: ["localStorage"],
    },
  });

// HTML <html lang="..."> attribute'unu aktif dile bağla.
// Bu, CSS `text-transform: uppercase` davranışını da etkiler:
//   - lang="tr" → `i` → `İ` (dotted upper, "AVAİLABLE" bug'ı)
//   - lang="en" → `i` → `I` (normal "AVAILABLE")
// İlk yüklemede + her dil değişiminde güncelle.
function syncHtmlLang(lng: string) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng?.startsWith("en") ? "en" : "tr";
  }
}
syncHtmlLang(i18n.language);
i18n.on("languageChanged", syncHtmlLang);

export default i18n;
