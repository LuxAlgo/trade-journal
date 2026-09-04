"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/use-api";
import { AiNotice } from "./ai-notice";

const SUGGESTIONS = [
  "What's my most expensive mistake?",
  "Which weekday should I stop trading?",
  "Am I better at longs or shorts?",
];

/** Natural-language questions against your own aggregates — BYO Anthropic key. */
export function AskJournal() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState("");

  const ask = async (q: string) => {
    if (busy || !q.trim()) return;
    q = q.trim();
    setLastQuestion(q);
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await postJson<{ answer: string }>("/api/ai/ask", { question: q });
      setAnswer(result.answer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask your journal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (question.trim()) void ask(question);
          }}
        >
          <Input
            aria-label="Ask your journal a question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Why do my Monday shorts keep failing?"
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            <Sparkles />
            {busy ? "Thinking…" : "Ask"}
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              disabled={busy}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:cursor-wait disabled:opacity-50"
              onClick={() => {
                setQuestion(suggestion);
                void ask(suggestion);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
        {error && (
          <AiNotice
            error={error}
            onRetry={() => void ask(lastQuestion)}
            onDismiss={() => setError(null)}
          />
        )}
        {answer && <p className="whitespace-pre-wrap pt-1 text-sm leading-relaxed">{answer}</p>}
      </CardContent>
    </Card>
  );
}
