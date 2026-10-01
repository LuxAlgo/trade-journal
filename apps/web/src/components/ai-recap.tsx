"use client";

import { Sparkles } from "lucide-react";
import type { AnalysisFilters } from "@luxalgo/journal-core";
import { Button } from "./ui/button";
import { AiNotice } from "./ai-notice";
import { postJson } from "@/lib/use-api";
import { useAiRequest, type AiScope } from "@/lib/use-ai-request";
import { AiChartsToggle, useAiCharts, type AiAnalysisUsed } from "./ai-charts-option";

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
  onRecap: (result: { recap: string; scope: AiScope; analyses?: AiAnalysisUsed[] }) => void;
}) {
  const { run, busy, error, dismiss } = useAiRequest();
  const [charts, setCharts] = useAiCharts();
  const generate = () =>
    run(
      () =>
        postJson<{ recap: string; scope: AiScope; analyses?: AiAnalysisUsed[] }>("/api/ai/recap", {
          date,
          filters,
          timeZone,
          // The server includes linked analyses unless told not to.
          ...(charts ? {} : { includeAnalyses: false }),
        }),
      onRecap,
    );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void generate()}
          disabled={busy || disabled}
        >
          <Sparkles />
          {busy ? "Writing…" : "AI recap"}
        </Button>
        <AiChartsToggle checked={charts} onChange={setCharts} />
      </div>
      {error && <AiNotice error={error} onRetry={() => void generate()} onDismiss={dismiss} />}
    </div>
  );
}
