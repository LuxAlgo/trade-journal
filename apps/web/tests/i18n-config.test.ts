import { describe, expect, it } from "vitest";
import {
  defaultLocale,
  formatLocale,
  isValidLocale,
  localeLabels,
  LOCALE_COOKIE,
  locales,
  resolveRequestedLocale,
  speechLocale,
  type Locale,
} from "../src/i18n/config";

describe("i18n config", () => {
  it("exposes exactly the seven supported locales with English as default", () => {
    expect([...locales]).toEqual(["en", "zh-CN", "ja", "ko", "zh-TW", "es", "fr"]);
    expect(defaultLocale).toBe("en");
    expect(LOCALE_COOKIE).toBe("NEXT_LOCALE");
  });

  it("accepts only exact enum members as locales", () => {
    for (const locale of locales) expect(isValidLocale(locale)).toBe(true);
    expect(isValidLocale("zh")).toBe(false);
    expect(isValidLocale("en-US")).toBe(false);
    expect(isValidLocale("EN")).toBe(false);
    expect(isValidLocale("fr ")).toBe(false);
    expect(isValidLocale("")).toBe(false);
    expect(isValidLocale(undefined)).toBe(false);
    expect(isValidLocale(null)).toBe(false);
    expect(isValidLocale(42)).toBe(false);
    expect(isValidLocale({ locale: "ja" })).toBe(false);
  });

  it("rejects request-controlled strings so they can never become paths", () => {
    expect(isValidLocale("../messages")).toBe(false);
    expect(isValidLocale("en/common")).toBe(false);
    expect(isValidLocale("en\\..\\common")).toBe(false);
    expect(isValidLocale(".")).toBe(false);
    expect(isValidLocale("..")).toBe(false);
  });

  it("resolves missing, corrupt or unknown cookie values back to the default locale", () => {
    expect(resolveRequestedLocale(undefined)).toBe("en");
    expect(resolveRequestedLocale(null)).toBe("en");
    expect(resolveRequestedLocale("")).toBe("en");
    expect(resolveRequestedLocale("xx")).toBe("en");
    expect(resolveRequestedLocale("EN")).toBe("en");
    expect(resolveRequestedLocale("en-US")).toBe("en");
    expect(resolveRequestedLocale("ja")).toBe("ja");
    expect(resolveRequestedLocale("zh-TW")).toBe("zh-TW");
  });

  it("maps every locale to its BCP 47 formatting and speech tags", () => {
    const expectations: Record<Locale, [string, string]> = {
      en: ["en-US", "en-US"],
      "zh-CN": ["zh-CN", "zh-CN"],
      ja: ["ja", "ja-JP"],
      ko: ["ko", "ko-KR"],
      "zh-TW": ["zh-TW", "zh-TW"],
      es: ["es-ES", "es-ES"],
      fr: ["fr-FR", "fr-FR"],
    };
    for (const locale of locales) {
      expect(formatLocale(locale)).toBe(expectations[locale][0]);
      expect(speechLocale(locale)).toBe(expectations[locale][1]);
    }
  });

  it("labels every locale in its own language", () => {
    expect(Object.keys(localeLabels).sort()).toEqual([...locales].sort());
    expect(localeLabels).toEqual({
      en: "English",
      "zh-CN": "简体中文",
      ja: "日本語",
      ko: "한국어",
      "zh-TW": "繁體中文",
      es: "Español",
      fr: "Français",
    });
  });
});
