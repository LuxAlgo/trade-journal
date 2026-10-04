import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDictationSession,
  dictationError,
  type DictationError,
  type SpeechRecognizer,
} from "../src/lib/dictation";

const setup = () => {
  const recognizer: SpeechRecognizer = {
    lang: "",
    continuous: false,
    interimResults: false,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onstart: null,
    onresult: null,
    onend: null,
    onerror: null,
  };
  const callbacks = { onText: vi.fn(), onState: vi.fn(), onError: vi.fn() };
  const session = createDictationSession(recognizer, callbacks, "en-US");
  return { recognizer, callbacks, session };
};
const result = (transcript: string, isFinal = true) => Object.assign([{ transcript }], { isFinal });
afterEach(() => {
  vi.useRealTimers();
});

describe("dictation sessions", () => {
  it("waits for actual listening, batches final phrases, and ignores interim/replayed results", () => {
    const { recognizer, callbacks, session } = setup();
    session.start();
    expect(callbacks.onState.mock.calls).toEqual([["starting"]]);
    recognizer.onstart?.();
    expect(callbacks.onState).toHaveBeenLastCalledWith("listening");
    recognizer.onresult?.({
      resultIndex: 1,
      results: [result("old"), result(" first "), result("second"), result("interim", false)],
    });
    expect(callbacks.onText.mock.calls).toEqual([["first second"]]);
    session.dispose();
  });
  it("maps raw recognizer and internal codes onto structured errors with English fallbacks", () => {
    for (const [raw, code, text] of [
      ["not-allowed", "not-allowed", "blocked"],
      ["service-not-allowed", "not-allowed", "blocked"],
      ["network", "network", "service"],
      ["audio-capture", "audio-capture", "microphone"],
      ["language-not-supported", "language-not-supported", "current language"],
      ["timeout", "timeout", "could not start"],
      ["totally-unknown", "start", "could not start"],
    ] as const) {
      const failure: DictationError = dictationError(raw);
      expect(failure.code).toBe(code);
      expect(failure.fallback).toContain(text);
    }
  });
  it("reports blocked permission, network failure and missing audio instead of failing silently", () => {
    for (const raw of ["not-allowed", "network", "audio-capture"]) {
      const { recognizer, callbacks, session } = setup();
      session.start();
      recognizer.onerror?.({ error: raw });
      const failure = callbacks.onError.mock.calls[0]?.[0] as DictationError;
      expect(failure.code).toBe(dictationError(raw).code);
      expect(failure.fallback).toBeTruthy();
      expect(callbacks.onState).toHaveBeenLastCalledWith("idle");
      expect(recognizer.onresult).toBeNull();
    }
  });
  it("handles a throwing or unresponsive speech service", () => {
    vi.useFakeTimers();
    const failed = setup();
    failed.recognizer.start = () => {
      throw new Error("Unavailable");
    };
    expect(() => failed.session.start()).not.toThrow();
    expect((failed.callbacks.onError.mock.calls[0]?.[0] as DictationError).code).toBe("start");
    const denied = setup();
    denied.recognizer.start = () => {
      const error = new Error("denied");
      error.name = "NotAllowedError";
      throw error;
    };
    denied.session.start();
    expect((denied.callbacks.onError.mock.calls[0]?.[0] as DictationError).code).toBe(
      "not-allowed",
    );
    const stalled = setup();
    stalled.session.start();
    vi.advanceTimersByTime(10000);
    expect((stalled.callbacks.onError.mock.calls[0]?.[0] as DictationError).code).toBe("timeout");
    expect(stalled.recognizer.abort).toHaveBeenCalledOnce();
  });
  it("allows the final phrase after Stop but blocks late writes after navigating away", () => {
    const { recognizer, callbacks, session } = setup();
    session.start();
    session.stop();
    recognizer.onresult?.({ resultIndex: 0, results: [result("Final phrase")] });
    expect(callbacks.onText).toHaveBeenCalledWith("Final phrase");
    const late = recognizer.onresult;
    session.dispose();
    late?.({ resultIndex: 0, results: [result("Wrong note")] });
    expect(callbacks.onText).toHaveBeenCalledOnce();
  });
});
