"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/use-api";
import { AiNotice } from "./ai-notice";
import { useFilters } from "./filter-bar";
import { useAiRequest, type AiScope } from "@/lib/use-ai-request";
import type { AnalysisFilters } from "@luxalgo/journal-core";

const SUGGESTION_KEYS = ["suggestionMistake", "suggestionWeekday", "suggestionDirection"] as const;

/** Natural-language questions against your own aggregates — BYO AI provider key. */
export function AskJournal() {
  const { values, query, timeZone } = useFilters();
  return <ScopedAskJournal key={`${timeZone}:${query}`} filters={values} timeZone={timeZone} />;
}

function ScopedAskJournal({ filters, timeZone }: { filters: AnalysisFilters; timeZone: string }) {
  const t = useTranslations("ai");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; scope: AiScope } | null>(null);
  const { run, busy, error, dismiss } = useAiRequest();
  const [lastQuestion, setLastQuestion] = useState("");
  const suggestions = SUGGESTION_KEYS.map((key) => t(`ask.${key}`));

  const ask = async (q: string) => {
    if (busy || !q.trim()) return;
    q = q.trim();
    setLastQuestion(q);
    setAnswer(null);
    await run(
      () =>
        postJson<{ answer: string; scope: AiScope }>("/api/ai/ask", {
          question: q,
          filters,
          timeZone,
        }),
      setAnswer,
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("ask.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">{t("ask.hint")}</p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (question.trim()) void ask(question);
          }}
        >
          <Input
            aria-label={t("ask.inputAriaLabel")}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t("ask.placeholder")}
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            <Sparkles />
            {busy ? t("ask.thinking") : t("ask.submit")}
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion, index) => (
            <button
              key={SUGGESTION_KEYS[index]}
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
          <AiNotice error={error} onRetry={() => void ask(lastQuestion)} onDismiss={dismiss} />
        )}
        {answer && (
          <div className="space-y-2 pt-1">
            <p className="text-xs text-muted-foreground">{answer.scope.label}</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.answer}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
