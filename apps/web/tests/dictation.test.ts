import { afterEach, describe, expect, it, vi } from "vitest";
import { createDictationSession, type SpeechRecognizer } from "../src/lib/dictation";

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
  it("reports blocked permission, network failure and missing audio instead of failing silently", () => {
    for (const [code, text] of [
      ["not-allowed", "blocked"],
      ["network", "service"],
      ["audio-capture", "microphone"],
    ]) {
      const { recognizer, callbacks, session } = setup();
      session.start();
      recognizer.onerror?.({ error: code! });
      expect(callbacks.onError.mock.calls[0]?.[0]).toContain(text);
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
    expect(failed.callbacks.onError).toHaveBeenCalledOnce();
    const stalled = setup();
    stalled.session.start();
    vi.advanceTimersByTime(10000);
    expect(stalled.callbacks.onError).toHaveBeenCalledOnce();
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
