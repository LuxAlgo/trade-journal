// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderWithLocale } from "./helpers/i18n";
import { installRadixShims } from "./helpers/jsdom";
import { localeLabels, locales } from "../src/i18n/config";
import type { SpeechRecognizer } from "../src/lib/dictation";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { VoiceNote } from "../src/components/voice-note";

/** SpeechRecognition double; instances are recorded for per-test asserts. */
const created: MockSpeechRecognition[] = [];
class MockSpeechRecognition implements SpeechRecognizer {
  lang = "";
  continuous = false;
  interimResults = false;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  onstart: (() => void) | null = null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor() {
    created.push(this);
  }
}
const final = (transcript: string) =>
  Object.assign([{ transcript }], { isFinal: true }) as ArrayLike<{ transcript: string }> & {
    isFinal: boolean;
  };

// Radix Popover relies on a few browser APIs jsdom does not implement.
beforeAll(installRadixShims);

const installRecognition = () => {
  (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;
};

const renderVoice = (locale: string) => {
  const onText = vi.fn();
  const onPrepare = vi.fn();
  // Button renders `title` through HoverHint (provider required; the app
  // shell mounts one in app/layout.tsx). delayDuration 0 opens it on focus.
  const view = renderWithLocale(
    createElement(TooltipProvider, {
      delayDuration: 0,
      children: createElement(VoiceNote, { onText, onPrepare }),
    }),
    { locale },
  );
  return { onText, onPrepare, view };
};

const dictateButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>("button")!;

const click = async (button: HTMLElement) => {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const changeSelect = async (select: HTMLSelectElement, value: string) => {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const alertText = () => document.body.querySelector<HTMLElement>('[role="alert"]')?.textContent;

afterEach(() => {
  const speechWindow = window as unknown as Record<string, unknown>;
  delete speechWindow.SpeechRecognition;
  delete speechWindow.webkitSpeechRecognition;
  created.length = 0;
  document.body.innerHTML = "";
});

describe("VoiceNote dictation language and state (T33)", () => {
  it("defaults the recognition language to the interface locale and localizes the control", async () => {
    for (const [uiLocale, expectedLang, starting, listening] of [
      ["en", "en-US", "Starting…", "Listening · Stop"],
      ["ja", "ja-JP", "開始中…", "音声認識中 · 停止"],
    ] as const) {
      installRecognition();
      const { view, onPrepare } = renderVoice(uiLocale);
      const button = dictateButton(view.container);
      await act(async () => {
        button.focus();
      });
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(
        uiLocale === "en" ? "Dictate your note" : "ノートを音声入力",
      );
      button.blur();
      const select = view.container.querySelector("select")!;
      expect(select.getAttribute("aria-label")).toBe(
        uiLocale === "en" ? "Dictation language" : "音声入力の言語",
      );
      await click(button);
      expect(created).toHaveLength(1);
      const recognizer = created[0]!;
      expect(recognizer.lang).toBe(expectedLang);
      expect(button.textContent).toBe(starting);
      await act(async () => {
        recognizer.onstart?.();
      });
      expect(button.textContent).toBe(listening);
      expect(onPrepare).toHaveBeenCalled();
      view.unmount();
      created.length = 0;
    }
  });

  it("lets the dropdown override only the recognition language (no cookie, no UI change)", async () => {
    installRecognition();
    const { view } = renderVoice("en");
    const select = view.container.querySelector<HTMLSelectElement>("select")!;
    expect(select.selectedOptions[0]?.textContent).toBe("Follow interface language");
    const optionTexts = [...select.options].map((option) => option.textContent);
    for (const locale of locales) {
      expect(optionTexts).toContain(localeLabels[locale]);
    }
    await changeSelect(select, "ja");
    expect(select.selectedOptions[0]?.textContent).toBe(localeLabels.ja);
    expect(document.cookie).not.toContain("NEXT_LOCALE");
    await click(dictateButton(view.container));
    expect(created[0]!.lang).toBe("ja-JP");
    view.unmount();
  });

  it("localizes permission and network failures instead of falling back to English", async () => {
    installRecognition();
    const ja = renderVoice("ja");
    await click(dictateButton(ja.view.container));
    await act(async () => {
      created[0]!.onerror?.({ error: "not-allowed" });
    });
    expect(alertText()).toBe(
      "マイクまたは音声へのアクセスがブロックされています。ブラウザとシステム設定でマイクへのアクセスを許可してから、もう一度お試しください。",
    );
    ja.view.unmount();
    created.length = 0;

    installRecognition();
    const en = renderVoice("en");
    await click(dictateButton(en.view.container));
    await act(async () => {
      created[0]!.onerror?.({ error: "network" });
    });
    expect(alertText()).toBe(
      "This browser could not reach its speech recognition service. Try Chrome with an internet connection, or use keyboard dictation below.",
    );
    en.view.unmount();
  });

  it("keeps a readable localized error when the browser has no speech recognition at all", async () => {
    const { view } = renderVoice("en");
    await click(dictateButton(view.container));
    expect(created).toHaveLength(0);
    expect(alertText()).toBe(
      "This browser does not support speech recognition. Open the journal in Chrome, or use keyboard dictation below.",
    );
    view.unmount();
  });

  it("drops in-flight results when the recognition language changes and restarts in the new language", async () => {
    installRecognition();
    const { onText, view } = renderVoice("en");
    await click(dictateButton(view.container));
    const first = created[0]!;
    await act(async () => {
      first.onstart?.();
    });
    await changeSelect(view.container.querySelector("select")!, "ko");
    expect(first.abort).toHaveBeenCalled();
    // Handlers are detached with the aborted session, so a late result from
    // the old language cannot be written anywhere.
    expect(first.onresult).toBeNull();
    expect(dictateButton(view.container).textContent).toBe("Dictate");
    await click(dictateButton(view.container));
    const second = created[1]!;
    expect(second.lang).toBe("ko-KR");
    await act(async () => {
      second.onstart?.();
      second.onresult?.({ resultIndex: 0, results: [final("Right note")] });
    });
    expect(onText).toHaveBeenCalledWith("Right note");
    view.unmount();
  });

  it("aborts the live recognizer on unmount so late results never reach the note", async () => {
    installRecognition();
    const { onText, view } = renderVoice("en");
    await click(dictateButton(view.container));
    const first = created[0]!;
    await act(async () => {
      first.onstart?.();
    });
    const lateResult = first.onresult;
    view.unmount();
    expect(first.abort).toHaveBeenCalled();
    await act(async () => {
      lateResult?.({ resultIndex: 0, results: [final("Wrong note")] });
    });
    expect(onText).not.toHaveBeenCalled();
  });
});
