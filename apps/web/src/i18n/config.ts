/**
 * Single source of truth for the seven supported interface languages.
 *
 * Locale codes here double as directory names under `apps/web/messages/`, so
 * every consumer must go through `isValidLocale` before using a request- or
 * cookie-supplied string as a path or dynamic import argument. T05/T02:
 * the cookie only ever stores members of this enum, never free-form text.
 */
export const locales = ["en", "zh-CN", "ja", "ko", "zh-TW", "es", "fr"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Cookie name carrying the user's language choice (set by /api/locale). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

const localeSet: ReadonlySet<string> = new Set(locales);

/** Narrow guard: only exact enum members pass — no normalization, no prefixes. */
export const isValidLocale = (value: unknown): value is Locale =>
  typeof value === "string" && localeSet.has(value);

/** Resolve a cookie value to a locale; missing or invalid values fall back to the default. */
export const resolveRequestedLocale = (value: string | undefined | null): Locale =>
  isValidLocale(value) ? value : defaultLocale;

/** Each language labelled in its own language (never translated). */
export const localeLabels: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  ja: "日本語",
  ko: "한국어",
  "zh-TW": "繁體中文",
  es: "Español",
  fr: "Français",
};

/** BCP 47 tags for Intl formatting (Intl.DateTimeFormat et al). */
const formatTags: Record<Locale, string> = {
  en: "en-US",
  "zh-CN": "zh-CN",
  ja: "ja",
  ko: "ko",
  "zh-TW": "zh-TW",
  es: "es-ES",
  fr: "fr-FR",
};

export const formatLocale = (locale: Locale): string => formatTags[locale];

/** BCP 47 tags handed to the browser speech APIs (dictation/readback). */
const speechTags: Record<Locale, string> = {
  en: "en-US",
  "zh-CN": "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  "zh-TW": "zh-TW",
  es: "es-ES",
  fr: "fr-FR",
};

export const speechLocale = (locale: Locale): string => speechTags[locale];
