"use client";

import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useLocale, useTranslations } from "next-intl";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createDictationSession,
  dictationError,
  unsupportedDictationError,
  type DictationError,
  type DictationErrorCode,
  type SpeechRecognizer,
} from "@/lib/dictation";
import { localeLabels, locales, speechLocale, type Locale } from "@/i18n/config";

/** Dictation error codes → voice-namespace keys (message keys are camelCase). */
const voiceErrorKeys: Record<DictationErrorCode, `error.${string}`> = {
  "not-allowed": "error.notAllowed",
  "audio-capture": "error.audioCapture",
  "no-speech": "error.noSpeech",
  network: "error.network",
  "language-not-supported": "error.languageNotSupported",
  timeout: "error.timeout",
  start: "error.start",
  unsupported: "error.unsupported",
};

/**
 * Dictation control (T33, docs/i18n.md §10).
 *
 * Recognition language defaults to the interface language's BCP 47 speech tag
 * and can be overridden per session from the dropdown; the override only feeds
 * the recognizer's `lang` — it never writes a cookie and never changes the UI
 * language. Switching language or unmounting aborts the live recognizer and
 * detaches its handlers, so late results cannot land in the wrong note.
 * Errors localize via the `voice` namespace by code and keep the original
 * English copy as the fallback.
 */
export function VoiceNote({
  onText,
  onPrepare,
}: {
  onText: (text: string) => void;
  onPrepare: () => void;
}) {
  const t = useTranslations("voice");
  const uiLocale = useLocale();
  const [state, setState] = useState<"idle" | "starting" | "listening">("idle");
  const [error, setError] = useState<DictationError | null>(null);
  const [override, setOverride] = useState<Locale | "">("");
  const [keyboardHint, setKeyboardHint] = useState(false);
  const callback = useRef(onText);
  callback.current = onText;
  const session = useRef<ReturnType<typeof createDictationSession> | null>(null);
  const recognitionLang = speechLocale(override || (uiLocale as Locale));
  const activeLang = useRef(recognitionLang);

  // Language switched (override or UI language) while a session may be live:
  // dispose aborts the recognizer and detaches its handlers, so a late result
  // from the old language is dropped instead of written into the note.
  useEffect(() => {
    if (activeLang.current === recognitionLang) return;
    activeLang.current = recognitionLang;
    session.current?.dispose();
    session.current = null;
    setState("idle");
  }, [recognitionLang]);
  useEffect(() => () => session.current?.dispose(), []);

  const showError = (failure: DictationError) => {
    setError(failure);
  };
  const toggle = () => {
    if (state !== "idle") {
      session.current?.stop();
      return;
    }
    session.current?.dispose();
    setKeyboardHint(false);
    setError(null);
    onPrepare();
    const speechWindow = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognizer;
      webkitSpeechRecognition?: new () => SpeechRecognizer;
    };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      showError(unsupportedDictationError);
      return;
    }
    try {
      session.current = createDictationSession(
        new Constructor(),
        {
          onText: (text) => callback.current(text),
          onState: setState,
          onError: showError,
        },
        activeLang.current,
      );
      session.current.start();
    } catch {
      showError(dictationError("start"));
    }
  };
  // Codes covered by the voice namespace render localized; anything else keeps
  // the original English copy from lib/dictation.ts.
  const errorText = error
    ? error.code in voiceErrorKeys
      ? t(voiceErrorKeys[error.code])
      : error.fallback
    : "";

  return (
    <Popover.Root
      open={Boolean(error)}
      onOpenChange={(open) => {
        if (!open) setError(null);
      }}
    >
      <div className="relative flex shrink-0 items-center gap-1">
        <select
          aria-label={t("language.label")}
          value={override}
          onChange={(event) => setOverride(event.target.value as Locale | "")}
          className="h-8 max-w-36 rounded-md border border-input bg-background px-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">{t("language.follow")}</option>
          {locales.map((locale) => (
            <option key={locale} value={locale}>
              {localeLabels[locale]}
            </option>
          ))}
        </select>
        <Popover.Anchor asChild>
          <Button
            type="button"
            variant={state === "idle" ? "outline" : "destructive"}
            size="sm"
            onClick={toggle}
            aria-pressed={state !== "idle"}
            title={state === "idle" ? t("title.idle") : t("title.active")}
          >
            {state === "idle" ? <Mic /> : <MicOff />}
            {state === "starting"
              ? t("state.starting")
              : state === "listening"
                ? t("state.listening")
                : t("state.idle")}
          </Button>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            aria-label={t("popover.label")}
            align="end"
            sideOffset={8}
            collisionPadding={12}
            onCloseAutoFocus={(event) => {
              if (keyboardHint) {
                event.preventDefault();
                onPrepare();
              }
            }}
            className="journal-popup z-50 max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-24px)] space-y-3 overflow-y-auto rounded-xl border bg-card p-4 text-sm shadow-lg"
          >
            <p role="alert">{errorText}</p>
            <p className="text-muted-foreground">{t("help.keyboard")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  session.current?.dispose();
                  setError(null);
                  setKeyboardHint(true);
                  onPrepare();
                }}
              >
                {t("popover.useKeyboard")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setError(null)}>
                {t("popover.dismiss")}
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
        {keyboardHint && (
          <span role="status" className="sr-only">
            {t("status.ready")}
          </span>
        )}
      </div>
    </Popover.Root>
  );
}
