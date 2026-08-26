"use client";

import { Suspense } from "react";
import { AskJournal } from "@/components/ask-journal";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { TimeHeatmap } from "@/components/charts/time-heatmap";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/use-api";
import { fmtPercent } from "@/lib/utils";

interface Bucket {
  key: string;
  trades: number;
  netPnl: number;
  winRate: number | null;
  profitFactor: number | null;
}

interface StatsPayload {
  buckets: Record<
    "symbol" | "tag" | "mistake" | "playbook" | "weekday" | "hour" | "duration" | "direction",
    Bucket[]
  >;
}

const SECTIONS: { key: keyof StatsPayload["buckets"]; title: string }[] = [
  { key: "symbol", title: "By symbol" },
  { key: "direction", title: "Long vs short" },
  { key: "weekday", title: "By weekday" },
  { key: "duration", title: "By holding time" },
  { key: "tag", title: "By tag" },
  { key: "mistake", title: "By mistake" },
  { key: "playbook", title: "By playbook" },
];

export default function ReportsPage() {
  return (
    <Suspense>
      <Reports />
    </Suspense>
  );
}

function Reports() {
  const { query } = useFilters();
  const { data } = useApi<StatsPayload>(`/api/stats?${query}`);

  return (
    <div>
      <FilterBar title="Reports" />
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <AskJournal />
        </div>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Trade time performance</CardTitle>
          </CardHeader>
          <CardContent>
            {data ? (
              <TimeHeatmap
                hours={data.buckets.hour.map((b) => ({
                  key: b.key,
                  netPnl: b.netPnl,
                  trades: b.trades,
                }))}
              />
            ) : (
              <Skeleton className="h-72" />
            )}
          </CardContent>
        </Card>
        {SECTIONS.map((section) => (
          <Card key={section.key}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              {!data ? (
                <Skeleton className="h-40" />
              ) : data.buckets[section.key].length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {section.key === "tag" || section.key === "mistake" || section.key === "playbook"
                    ? "Annotate trades to unlock this breakdown."
                    : "No data yet."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{section.title.replace("By ", "")}</TableHead>
                      <TableHead className="text-right">Trades</TableHead>
                      <TableHead className="text-right">Win %</TableHead>
                      <TableHead className="text-right">Net P&L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.buckets[section.key].map((bucket) => (
                      <TableRow key={bucket.key}>
                        <TableCell className="font-medium">{bucket.key}</TableCell>
                        <TableCell className="tnum text-right text-muted-foreground">
                          {bucket.trades}
                        </TableCell>
                        <TableCell className="tnum text-right">
                          {fmtPercent(bucket.winRate, 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Pnl value={bucket.netPnl} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
