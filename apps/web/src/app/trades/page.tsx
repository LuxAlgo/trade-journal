"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import {
  createSortedRowModel,
  rowSelectionFeature,
  rowSortingFeature,
  columnVisibilityFeature,
  tableFeatures,
  useTable,
  sortFns,
  type ColumnDef,
} from "@tanstack/react-table";
import { ArrowUpDown, Check, Columns3, Download, Tag, Trash2 } from "lucide-react";
import type { TradeMetrics } from "@luxalgo/journal-core";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { postJson, useApi } from "@/lib/use-api";
import { cn, fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";

interface TradeRow {
  key: string;
  accountId: string;
  symbol: string;
  direction: "long" | "short";
  status: string;
  openedAt: string;
  closedAt: string | null;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  grossPnl: number;
  fees: number;
  netPnl: number;
  executionCount: number;
  durationMs: number | null;
  rating: number | null;
  tags: string[];
  mistakes: string[];
  reviewed: boolean;
}

const features = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

export default function TradesPage() {
  return (
    <Suspense>
      <Trades />
    </Suspense>
  );
}

function Trades() {
  const { query } = useFilters();
  const { data, refresh } = useApi<{ trades: TradeRow[]; metrics: TradeMetrics }>(
    `/api/trades?${query}`,
  );
  const router = useRouter();
  const [tagInput, setTagInput] = useState("");
  const [showColumns, setShowColumns] = useState(false);

  const columns = useMemo<ColumnDef<typeof features, TradeRow>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllRowsSelected()}
            onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
            onClick={(event) => event.stopPropagation()}
            aria-label="Select trade"
          />
        ),
      },
      {
        id: "closedAt",
        accessorKey: "closedAt",
        header: "Close date",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">
            {(getValue<string | null>() ?? "open").slice(0, 10)}
          </span>
        ),
      },
      {
        id: "symbol",
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ row, getValue }) => (
          <span className="flex items-center gap-2 font-medium">
            {getValue<string>()}
            <span className="text-xs text-muted-foreground">{row.original.direction}</span>
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => {
          const status = getValue<string>();
          return (
            <Badge variant={status === "win" ? "profit" : status === "loss" ? "loss" : "secondary"}>
              {status.toUpperCase()}
            </Badge>
          );
        },
      },
      {
        id: "quantity",
        accessorKey: "quantity",
        header: "Volume",
        cell: ({ getValue }) => <span className="tnum">{fmtNumber(getValue<number>(), 4)}</span>,
      },
      {
        id: "avgEntry",
        accessorKey: "avgEntry",
        header: "Entry",
        cell: ({ getValue }) => <span className="tnum">{fmtNumber(getValue<number>())}</span>,
      },
      {
        id: "avgExit",
        accessorKey: "avgExit",
        header: "Exit",
        cell: ({ getValue }) => (
          <span className="tnum">
            {getValue<number | null>() === null ? "–" : fmtNumber(getValue<number>()!)}
          </span>
        ),
      },
      {
        id: "netPnl",
        accessorKey: "netPnl",
        header: "Net P&L",
        cell: ({ getValue }) => <Pnl value={getValue<number>()} />,
      },
      {
        id: "roi",
        accessorFn: (row) =>
          row.avgEntry * row.quantity > 0 ? row.netPnl / (row.avgEntry * row.quantity) : 0,
        header: "Net ROI",
        cell: ({ getValue }) => <span className="tnum">{fmtPercent(getValue<number>(), 2)}</span>,
      },
      {
        id: "fees",
        accessorKey: "fees",
        header: "Fees",
        cell: ({ getValue }) => (
          <span className="tnum text-muted-foreground">{fmtMoney(getValue<number>())}</span>
        ),
      },
      {
        id: "durationMs",
        accessorKey: "durationMs",
        header: "Duration",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{fmtDuration(getValue<number | null>())}</span>
        ),
      },
      {
        id: "executionCount",
        accessorKey: "executionCount",
        header: "Execs",
        cell: ({ getValue }) => (
          <span className="tnum text-muted-foreground">{getValue<number>()}</span>
        ),
      },
      {
        id: "tags",
        accessorKey: "tags",
        enableSorting: false,
        header: "Tags",
        cell: ({ getValue }) => (
          <span className="flex max-w-40 flex-wrap gap-1">
            {getValue<string[]>().map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </span>
        ),
      },
      {
        id: "rating",
        accessorKey: "rating",
        header: "Rating",
        cell: ({ getValue }) => {
          const rating = getValue<number | null>();
          return (
            <span className="text-muted-foreground">
              {rating === null ? "–" : "★".repeat(rating)}
            </span>
          );
        },
      },
      {
        id: "reviewed",
        accessorKey: "reviewed",
        header: "Reviewed",
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <Check className="h-4 w-4 text-profit" />
          ) : (
            <span className="text-muted-foreground">–</span>
          ),
      },
    ],
    [],
  );

  const table = useTable({
    features,
    columns,
    data: data?.trades ?? [],
    getRowId: (row) => row.key,
    initialState: {
      sorting: [{ id: "closedAt", desc: true }],
      columnVisibility: { fees: false, executionCount: false, rating: false },
    },
  });

  const selectedKeys = table.getSelectedRowModel().rows.map((row) => row.original.key);
  const bulk = async (action: string, extra?: Record<string, unknown>) => {
    await postJson("/api/trades/bulk", { keys: selectedKeys, action, ...extra });
    table.resetRowSelection();
    refresh();
  };

  const m = data?.metrics;
  return (
    <div>
      <FilterBar
        title="Trades"
        actions={
          <div className="flex items-center gap-2">
            <a href={`/api/export?format=csv`} download>
              <Button variant="outline" size="sm">
                <Download />
                CSV
              </Button>
            </a>
            <Button variant="outline" size="sm" onClick={() => setShowColumns((value) => !value)}>
              <Columns3 />
              Columns
            </Button>
          </div>
        }
      />
      <div className="space-y-3 p-4">
        {m && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Net cumulative P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <Pnl value={m.netPnl} className="text-xl font-semibold" />
                <span className="ml-2 text-xs text-muted-foreground">{m.closedTrades} trades</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Profit factor</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-xl font-semibold tnum">
                  {m.profitFactorIsInfinite
                    ? "∞"
                    : m.profitFactor === null
                      ? "–"
                      : fmtNumber(m.profitFactor)}
                </span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Trade win %</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-xl font-semibold tnum">{fmtPercent(m.winRate)}</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Avg win / loss</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-xl font-semibold tnum">
                  {m.avgWinLossRatio === null ? "–" : fmtNumber(m.avgWinLossRatio)}
                </span>
              </CardContent>
            </Card>
          </div>
        )}

        {showColumns && (
          <Card>
            <CardContent className="flex flex-wrap gap-3 py-3">
              {table
                .getAllLeafColumns()
                .filter((column) => column.id !== "select")
                .map((column) => (
                  <label key={column.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(value === true)}
                    />
                    {typeof column.columnDef.header === "string"
                      ? column.columnDef.header
                      : column.id}
                  </label>
                ))}
            </CardContent>
          </Card>
        )}

        {selectedKeys.length > 0 && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 py-2">
              <span className="text-sm text-muted-foreground">{selectedKeys.length} selected</span>
              <Button variant="outline" size="sm" onClick={() => bulk("review")}>
                <Check />
                Mark reviewed
              </Button>
              <Button variant="outline" size="sm" onClick={() => bulk("unreview")}>
                Unreview
              </Button>
              <div className="flex items-center gap-1">
                <Input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="tag"
                  className="h-8 w-28 text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!tagInput}
                  onClick={() => {
                    void bulk("tag", { tag: tagInput });
                    setTagInput("");
                  }}
                >
                  <Tag />
                  Tag
                </Button>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (
                    confirm(
                      `Delete ${selectedKeys.length} trades and their executions? This cannot be undone.`,
                    )
                  )
                    void bulk("delete");
                }}
              >
                <Trash2 />
                Delete
              </Button>
            </CardContent>
          </Card>
        )}

        {!data ? (
          <Skeleton className="h-96" />
        ) : (
          <Card>
            <div className="relative w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id} className="border-b">
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className="h-9 whitespace-nowrap px-2 text-left text-xs font-medium text-muted-foreground"
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <button
                              className="inline-flex items-center gap-1 hover:text-foreground"
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              <table.FlexRender header={header} />
                              <ArrowUpDown
                                className={cn(
                                  "h-3 w-3",
                                  header.column.getIsSorted() && "text-foreground",
                                )}
                              />
                            </button>
                          ) : (
                            <table.FlexRender header={header} />
                          )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50"
                      onClick={() => router.push(`/trades/${encodeURIComponent(row.original.key)}`)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="whitespace-nowrap px-2 py-2 align-middle">
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {table.getRowModel().rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="py-16 text-center text-muted-foreground"
                      >
                        No trades match these filters.{" "}
                        <Link href="/import" className="underline">
                          Import some
                        </Link>
                        .
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
