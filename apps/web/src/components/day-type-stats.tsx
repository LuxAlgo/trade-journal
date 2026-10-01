"use client";

import { useState } from "react";
import { useApi } from "@/lib/use-api";
import type { DayTypeBreakdown } from "@/server/day-types";
import { Pnl } from "./pnl";
import { Button } from "./ui/button";
import { SectionCard } from "./section-card";

const PERIODS = [30, 90, 180, 365] as const;

/**
 * Closed trades split by the kind of day they closed on, computed from each symbol's daily
 * candles (fetched on request, so opening the journal never calls a market data source).
 */
export function DayTypeStats() {
  const [days, setDays] = useState<(typeof PERIODS)[number] | null>(null);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(90);
  const { data, error, loading } = useApi<DayTypeBreakdown>(
    days ? `/api/day-types?days=${days}` : null,
  );
  return (
    <SectionCard
      id="journal-day-types"
      title="Results by day type"
      contentClassName="space-y-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Period"
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value) as (typeof PERIODS)[number])}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              Last {p} days
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => setDays(period)}
        >
          {data && days === period ? "Refresh" : "Show"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Trend or range, quiet or volatile, news or not: from each symbol&apos;s daily candles.
        </span>
      </div>
      {loading && <p className="text-muted-foreground">Reading daily candles…</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {data && !loading && (
        <>
          {data.rows.length === 0 ? (
            <p className="text-muted-foreground">No closed trades with candles in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Day type</th>
                  <th className="py-1 text-right font-medium">Trades</th>
                  <th className="py-1 text-right font-medium">Win rate</th>
                  <th className="py-1 text-right font-medium">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.tag} className="border-t">
                    <td className="py-1">{row.tag}</td>
                    <td className="tnum py-1 text-right">{row.trades}</td>
                    <td className="tnum py-1 text-right">
                      {Math.round((row.wins / row.trades) * 100)}%
                    </td>
                    <td className="py-1 text-right">
                      <Pnl value={row.netPnl} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted-foreground">
            Each trade counts once per group (shape, volatility, news). Totals add accounts without
            converting currencies.
            {data.symbols.some((s) => s.problem) &&
              ` Left out: ${data.symbols
                .filter((s) => s.problem)
                .map((s) => `${s.symbol} (${s.problem})`)
                .join(", ")}.`}
          </p>
        </>
      )}
    </SectionCard>
  );
}
