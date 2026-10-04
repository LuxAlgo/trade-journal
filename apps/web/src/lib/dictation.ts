export interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

/**
 * Closed set of dictation failure keys (docs/i18n.md §10, T33). Each code has
 * a `voice.error.<camelCase>` message key per locale; `fallback` keeps the
 * original English copy for rendering when a code has no localized message.
 */
export const dictationErrorCodes = [
  "not-allowed",
  "audio-capture",
  "no-speech",
  "network",
  "language-not-supported",
  "timeout",
  "start",
  "unsupported",
] as const;

export type DictationErrorCode = (typeof dictationErrorCodes)[number];

export interface DictationError {
  /** Stable code; localizes via the `voice` namespace when covered there. */
  code: DictationErrorCode;
  /** Original English copy (semantic baseline), shown as the fallback. */
  fallback: string;
}

/** code → original English copy, preserved verbatim from the pre-T33 UI. */
const dictationErrorFallbacks: Record<DictationErrorCode, string> = {
  "not-allowed":
    "Microphone or speech access was blocked. Allow microphone access in your browser and system settings, then try again.",
  "audio-capture": "No microphone is available. Connect or enable a microphone, then try again.",
  "no-speech": "No speech was detected. Try again and speak after the button says Listening.",
  network:
    "This browser could not reach its speech recognition service. Try Chrome with an internet connection, or use keyboard dictation below.",
  "language-not-supported":
    "This browser does not support dictation in your current language. Use keyboard dictation below.",
  // The timeout path has always surfaced the generic start-failure copy.
  timeout:
    "Speech recognition could not start in this browser. Try Chrome, or use keyboard dictation below.",
  start:
    "Speech recognition could not start in this browser. Try Chrome, or use keyboard dictation below.",
  unsupported:
    "This browser does not support speech recognition. Open the journal in Chrome, or use keyboard dictation below.",
};

/**
 * Normalize a raw recognizer/browser error code onto the closed set.
 * `service-not-allowed` merges into `not-allowed` (same remediation copy);
 * anything unrecognized keeps the generic start failure.
 */
export const dictationErrorCode = (raw: string): DictationErrorCode => {
  switch (raw) {
    case "not-allowed":
    case "service-not-allowed":
      return "not-allowed";
    case "audio-capture":
    case "no-speech":
    case "network":
    case "language-not-supported":
    case "timeout":
      return raw;
    default:
      return "start";
  }
};

/** Structured dictation error: localization key plus English fallback copy. */
export const dictationError = (code: string): DictationError => {
  const normalized = dictationErrorCode(code);
  return { code: normalized, fallback: dictationErrorFallbacks[normalized] };
};

/** Raised by the control itself when the browser exposes no recognition API. */
export const unsupportedDictationError: DictationError = {
  code: "unsupported",
  fallback: dictationErrorFallbacks.unsupported,
};

/** One recognition session. Final results are batched; handlers are detached on disposal. */
export function createDictationSession(
  recognizer: SpeechRecognizer,
  callbacks: {
    onText(text: string): void;
    onState(state: "starting" | "listening" | "idle"): void;
    onError(error: DictationError): void;
  },
  language: string,
) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
  };
  const detach = () => {
    clear();
    active = false;
    recognizer.onstart = recognizer.onresult = recognizer.onend = recognizer.onerror = null;
  };
  const fail = (failure: DictationError) => {
    if (!active) return;
    detach();
    try {
      recognizer.abort();
    } catch {}
    callbacks.onState("idle");
    callbacks.onError(failure);
  };
  recognizer.lang = language;
  recognizer.continuous = true;
  recognizer.interimResults = false;
  recognizer.onstart = () => {
    clear();
    if (active) callbacks.onState("listening");
  };
  recognizer.onresult = (event) => {
    if (!active) return;
    const parts: string[] = [];
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result?.isFinal && result[0]?.transcript.trim()) parts.push(result[0].transcript.trim());
    }
    if (parts.length) callbacks.onText(parts.join(" "));
  };
  recognizer.onend = () => {
    detach();
    callbacks.onState("idle");
  };
  recognizer.onerror = (event) => fail(dictationError(event.error));
  return {
    start() {
      callbacks.onState("starting");
      timer = setTimeout(() => fail(dictationError("timeout")), 10000);
      try {
        recognizer.start();
      } catch (error) {
        fail(
          dictationError(
            error instanceof Error && error.name === "NotAllowedError" ? "not-allowed" : "start",
          ),
        );
      }
    },
    stop() {
      if (!active) return;
      clear();
      // stop() allows the engine to deliver its final transcript before onend.
      try {
        recognizer.stop();
      } catch {
        detach();
      }
      callbacks.onState("idle");
    },
    dispose() {
      detach();
      try {
        recognizer.abort();
      } catch {}
    },
  };
}
