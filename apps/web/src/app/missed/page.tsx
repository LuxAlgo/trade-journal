"use client";
import { Suspense, useState } from "react";
import { FilterBar } from "@/components/filter-bar";
import { Field, fieldClass } from "@/components/filter-fields";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichEditor, Markdown } from "@/components/rich-editor";
import { Attachments } from "@/components/attachments";
import { ReviewExport } from "@/components/review-export";
import { MonetaryValue, MonetaryField } from "@/components/privacy";
import { useApi, postJson } from "@/lib/use-api";
interface Missed {
  id: string;
  symbol: string;
  direction: string;
  observedAt: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  playbookId: string | null;
  notes: string;
  archivedAt: string | null;
}
const blank = () => ({
  symbol: "",
  direction: "long",
  observedAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16),
  entry: "",
  stop: "",
  target: "",
  playbookId: "",
  notes: "",
});
export default function MissedPage() {
  return (
    <Suspense>
      <Missed />
    </Suspense>
  );
}
function Missed() {
  const { data, error, refresh } = useApi<{ trades: Missed[] }>("/api/workspace/missed"),
    { data: books } = useApi<{ playbooks: { id: string; name: string }[] }>("/api/playbooks");
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [draft, setDraft] = useState(blank),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false);
  function edit(t?: Missed) {
    setEditing(t?.id ?? null);
    setDraft(
      t
        ? {
            symbol: t.symbol,
            direction: t.direction,
            observedAt: new Date(
              Date.parse(t.observedAt) - new Date(t.observedAt).getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16),
            entry: t.entry?.toString() ?? "",
            stop: t.stop?.toString() ?? "",
            target: t.target?.toString() ?? "",
            playbookId: t.playbookId ?? "",
            notes: t.notes,
          }
        : blank(),
    );
    setFailure("");
    setOpen(true);
  }
  const rows =
    data?.trades.filter(
      (t) =>
        Boolean(t.archivedAt) === archived &&
        `${t.symbol} ${t.notes}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const formField = (
    key: "symbol" | "observedAt" | "entry" | "stop" | "target",
    label: string,
    type = "text",
  ) => (
    <Field label={label}>
      <MonetaryField sensitive={type === "number"}>
        <input
          className={fieldClass}
          type={type}
          step={type === "number" ? "any" : undefined}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      </MonetaryField>
    </Field>
  );
  return (
    <div>
      <FilterBar
        title="Missed trades"
        actions={
          <Button size="sm" onClick={() => edit()}>
            Log opportunity
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          Record setups you watched but did not take. These observations never enter your trade
          count, P&L, or win rate.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <input
            aria-label="Search missed trades"
            className={`${fieldClass} max-w-sm`}
            placeholder="Search symbol or notes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
        {(error || failure) && (
          <p role="alert" className="text-sm text-destructive">
            {error || failure}
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>
                    {t.symbol} · {t.direction}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => edit(t)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          await postJson(
                            "/api/workspace/missed",
                            { id: t.id, restore: !!t.archivedAt },
                            "DELETE",
                          );
                          refresh();
                        } catch (e) {
                          setFailure(String(e));
                        }
                      }}
                    >
                      {t.archivedAt ? "Restore" : "Archive"}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(t.observedAt).toLocaleString()} ·{" "}
                  {books?.playbooks.find((b) => b.id === t.playbookId)?.name ?? "No strategy"}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-5 text-sm">
                  {[
                    ["Entry", t.entry],
                    ["Stop", t.stop],
                    ["Target", t.target],
                  ].map(([label, value]) => (
                    <span key={label}>
                      <span className="text-muted-foreground">{label}: </span>
                      <MonetaryValue>{value ?? "—"}</MonetaryValue>
                    </span>
                  ))}
                </div>
                <Markdown>{t.notes || "No review yet."}</Markdown>
                <ReviewExport
                  containsFinancialData
                  document={{
                    title: `Missed opportunity · ${t.symbol}`,
                    subtitle: `${t.direction} · ${t.observedAt}`,
                    lines: [
                      "Observation only — no executed trade or actual P&L.",
                      `Planned entry: ${t.entry ?? "—"} | Stop: ${t.stop ?? "—"} | Target: ${t.target ?? "—"}`,
                      "",
                      t.notes,
                    ],
                  }}
                />
                <Attachments type="missed" id={t.id} />
              </CardContent>
            </Card>
          ))}
        </div>
        {data && !rows.length && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No {archived ? "archived " : ""}opportunities here yet.
          </p>
        )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit opportunity" : "Log a missed opportunity"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {formField("symbol", "Symbol")}
              <Field label="Direction">
                <select
                  className={fieldClass}
                  value={draft.direction}
                  onChange={(e) => setDraft({ ...draft, direction: e.target.value })}
                >
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </Field>
              {formField("observedAt", "Observed at (device time)", "datetime-local")}
              <Field label="Strategy">
                <select
                  className={fieldClass}
                  value={draft.playbookId}
                  onChange={(e) => setDraft({ ...draft, playbookId: e.target.value })}
                >
                  <option value="">No strategy</option>
                  {books?.playbooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {formField("entry", "Planned entry", "number")}
              {formField("stop", "Planned stop", "number")}
              {formField("target", "Planned target", "number")}
            </div>
            <RichEditor
              defaultMode="edit"
              value={draft.notes}
              onChange={(notes) => setDraft({ ...draft, notes })}
              placeholder="Why did you miss it? What will you do differently?"
            />
            {failure && (
              <p role="alert" className="text-xs text-destructive">
                {failure}
              </p>
            )}
            <Button
              disabled={busy || !draft.symbol.trim() || !draft.observedAt}
              onClick={async () => {
                setBusy(true);
                try {
                  await postJson("/api/workspace/missed", {
                    ...draft,
                    id: editing,
                    observedAt: new Date(draft.observedAt).toISOString(),
                    entry: draft.entry === "" ? null : Number(draft.entry),
                    stop: draft.stop === "" ? null : Number(draft.stop),
                    target: draft.target === "" ? null : Number(draft.target),
                  });
                  setOpen(false);
                  refresh();
                  setFailure("");
                } catch (e) {
                  setFailure(e instanceof Error ? e.message : "Could not save.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save opportunity
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
