"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Languages } from "lucide-react";
import { LOCALE_KEY, localePreference, localeTag, type Locale } from "@/lib/locale";
import { fill, messagesFor, type Messages } from "@/lib/messages";
import { Button } from "./ui/button";

interface LocaleValue {
  locale: Locale;
  ready: boolean;
  text: Messages;
  setLocale: (next: Locale) => void;
}

const fallback: LocaleValue = {
  locale: "en",
  ready: true,
  text: messagesFor("en"),
  setLocale: () => {},
};

const LocaleContext = createContext<LocaleValue>(fallback);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const apply = (next: Locale) => {
    document.documentElement.lang = localeTag(next);
    setLocaleState(next);
  };
  useEffect(() => {
    apply(localePreference(document.documentElement.lang === "zh-CN" ? "zh" : "en"));
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === LOCALE_KEY || event.key === null) {
        apply(localePreference(event.newValue));
        setError("");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const setLocale = (next: Locale) => {
    apply(next);
    try {
      localStorage.setItem(LOCALE_KEY, next);
      setError("");
    } catch {
      setError(messagesFor(next).language.unsaved);
    }
  };
  return (
    <LocaleContext.Provider value={{ locale, ready, text: messagesFor(locale), setLocale }}>
      {children}
      {error && (
        <p
          role="status"
          className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-32px)] rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground"
        >
          {error}
        </p>
      )}
    </LocaleContext.Provider>
  );
}

export function useI18n() {
  return useContext(LocaleContext);
}

export function LanguageToggle({ iconOnly = false }: { iconOnly?: boolean }) {
  const { locale, ready, text, setLocale } = useI18n();
  const next: Locale = locale === "zh" ? "en" : "zh";
  const label = `${text.language.switchTo}: ${next === "zh" ? text.language.chinese : text.language.english}`;
  return (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? "icon" : "sm"}
      className={
        iconOnly
          ? "h-9 w-9 shrink-0 rounded-lg"
          : "w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
      }
      disabled={!ready}
      onClick={() => setLocale(next)}
      aria-label={label}
      title={iconOnly ? label : undefined}
    >
      <Languages aria-hidden="true" />
      {!iconOnly && (locale === "zh" ? text.language.english : text.language.chinese)}
    </Button>
  );
}

export function LanguageSettings() {
  const { locale, text, setLocale } = useI18n();
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{text.language.title}</h3>
        <p className="text-sm text-muted-foreground">{text.language.description}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={text.language.label}>
        {(
          [
            ["en", text.language.english],
            ["zh", text.language.chinese],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={locale === id ? "secondary" : "outline"}
            aria-pressed={locale === id}
            onClick={() => setLocale(id)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export { fill };
