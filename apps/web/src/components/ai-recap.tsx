"use client";

import { Sparkles } from "lucide-react";
import type { AnalysisFilters } from "@luxalgo/journal-core";
import { Button } from "./ui/button";
import { AiNotice } from "./ai-notice";
import { postJson } from "@/lib/use-api";
import { useAiRequest, type AiScope } from "@/lib/use-ai-request";

/** The parent keys this component by date, filters and timezone. */
export function AiRecap({
  date,
  filters,
  timeZone,
  disabled,
  onRecap,
}: {
  date: string;
  filters: AnalysisFilters;
  timeZone: string;
  disabled: boolean;
  onRecap: (result: { recap: string; scope: AiScope }) => void;
}) {
  const { run, busy, error, dismiss } = useAiRequest();
  const generate = () =>
    run(
      () =>
        postJson<{ recap: string; scope: AiScope }>("/api/ai/recap", { date, filters, timeZone }),
      onRecap,
    );
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void generate()}
        disabled={busy || disabled}
      >
        <Sparkles />
        {busy ? "Writing…" : "AI recap"}
      </Button>
      {error && <AiNotice error={error} onRetry={() => void generate()} onDismiss={dismiss} />}
    </div>
  );
}
