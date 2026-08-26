"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

const getRecognizer = (): SpeechRecognitionLike | null => {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
};

/**
 * Voice journaling — dictation via the browser's Web Speech API. Zero keys,
 * zero cost, works offline in Chromium. Emits text into the note editor;
 * optional AI cleanup happens downstream.
 */
export function VoiceNote({ onText }: { onText: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getRecognizer() !== null);
    return () => recognizerRef.current?.stop();
  }, []);

  const toggle = () => {
    if (recording) {
      recognizerRef.current?.stop();
      setRecording(false);
      return;
    }
    const recognizer = getRecognizer();
    if (!recognizer) return;
    recognizer.lang = navigator.language || "en-US";
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) onText(result[0]!.transcript.trim() + " ");
      }
    };
    recognizer.onend = () => setRecording(false);
    recognizer.onerror = () => setRecording(false);
    recognizerRef.current = recognizer;
    recognizer.start();
    setRecording(true);
  };

  if (!supported) return null;
  return (
    <Button
      type="button"
      variant={recording ? "destructive" : "outline"}
      size="sm"
      onClick={toggle}
      title={recording ? "Stop dictation" : "Dictate your note"}
    >
      {recording ? <MicOff /> : <Mic />}
      {recording ? "Stop" : "Dictate"}
    </Button>
  );
}
