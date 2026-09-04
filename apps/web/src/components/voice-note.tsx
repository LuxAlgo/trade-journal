"use client";

import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createDictationSession, dictationError, type SpeechRecognizer } from "@/lib/dictation";

/** Browser speech recognition requires microphone permission and sometimes a network service. */
export function VoiceNote({
  onText,
  onPrepare,
}: {
  onText: (text: string) => void;
  onPrepare: () => void;
}) {
  const [state, setState] = useState<"idle" | "starting" | "listening">("idle");
  const [error, setError] = useState("");
  const [keyboardHint, setKeyboardHint] = useState(false);
  const callback = useRef(onText);
  callback.current = onText;
  const session = useRef<ReturnType<typeof createDictationSession> | null>(null);
  useEffect(() => () => session.current?.dispose(), []);

  const showError = (message: string) => {
    setError(message);
  };
  const toggle = () => {
    if (state !== "idle") {
      session.current?.stop();
      return;
    }
    session.current?.dispose();
    setKeyboardHint(false);
    setError("");
    onPrepare();
    const speechWindow = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognizer;
      webkitSpeechRecognition?: new () => SpeechRecognizer;
    };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      showError(
        "This browser does not support speech recognition. Open the journal in Chrome, or use keyboard dictation below.",
      );
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
        navigator.language || "en-US",
      );
      session.current.start();
    } catch {
      showError(dictationError("start"));
    }
  };

  return (
    <Popover.Root
      open={Boolean(error)}
      onOpenChange={(open) => {
        if (!open) setError("");
      }}
    >
      <div className="relative shrink-0">
        <Popover.Anchor asChild>
          <Button
            type="button"
            variant={state === "idle" ? "outline" : "destructive"}
            size="sm"
            onClick={toggle}
            aria-pressed={state !== "idle"}
            title={state === "idle" ? "Dictate your note" : "Stop dictation"}
          >
            {state === "idle" ? <Mic /> : <MicOff />}
            {state === "starting"
              ? "Starting…"
              : state === "listening"
                ? "Listening · Stop"
                : "Dictate"}
          </Button>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            aria-label="Dictation help"
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
            <p role="alert">{error}</p>
            <p className="text-muted-foreground">
              Keyboard dictation types directly into your note. Use your keyboard’s microphone key
              or your system’s dictation shortcut. On Mac, enable Dictation in System Settings →
              Keyboard.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  session.current?.dispose();
                  setError("");
                  setKeyboardHint(true);
                  onPrepare();
                }}
              >
                Use keyboard dictation
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setError("")}>
                Dismiss
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
        {keyboardHint && (
          <span role="status" className="sr-only">
            Note ready. Press your keyboard’s microphone key or dictation shortcut to speak.
          </span>
        )}
      </div>
    </Popover.Root>
  );
}
