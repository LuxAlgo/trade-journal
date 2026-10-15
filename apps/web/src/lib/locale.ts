export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_KEY = "journal-locale-v1";

export const localePreference = (value: string | null | undefined): Locale =>
  value === "zh" ? "zh" : "en";

export const localeTag = (locale: Locale): "en" | "zh-CN" => (locale === "zh" ? "zh-CN" : "en");

// Runs in <head> before paint so a saved language does not flash English.
export const LOCALE_INIT_SCRIPT = `(()=>{let locale="en";try{locale=localStorage.getItem(${JSON.stringify(LOCALE_KEY)})==="zh"?"zh":"en"}catch{}document.documentElement.lang=locale==="zh"?"zh-CN":"en"})();`;
