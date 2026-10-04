"use client";
import { DatePicker } from "@/components/ui/date-picker";
import { OptionSelect } from "@/components/ui/option-select";
import { Checkbox } from "@/components/ui/checkbox";

import { HoverHint } from "@/components/ui/tooltip";
import { Suspense, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FilterBar } from "@/components/filter-bar";
import { Field, fieldClass } from "@/components/filter-fields";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReviewExport } from "@/components/review-export";
import { useApi, postJson } from "@/lib/use-api";
import { formatApiError } from "@/lib/api-error";
import { scheduledRules, progressScore, type Routine, type RoutineCheck } from "@/lib/progress";
import { weekdayLabel } from "@/lib/calendar-insights";
import { formatLocale, type Locale } from "@/i18n/config";
// Machine stage values stored on routines and matched against r.stage; the
// display names come from the `progress.stage.*` messages.
const STAGES = ["Before trading", "During trading", "After trading"] as const;
const STAGE_KEYS: Record<(typeof STAGES)[number], string> = {
  "Before trading": "before",
  "During trading": "during",
  "After trading": "after",
};
export default function ProgressPage() {
  return (
    <Suspense>
      <Progress />
    </Suspense>
  );
}
function Progress() {
  const t = useTranslations("progress");
  const tCommon = useTranslations("common");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const locale = useLocale() as Locale;
  const fmtLocale = formatLocale(locale);
  const stageLabel = (s: string) =>
    s in STAGE_KEYS ? t(`stage.${STAGE_KEYS[s as (typeof STAGES)[number]]}`) : s;
  const dayHeading = useMemo(
    () => new Intl.DateTimeFormat(fmtLocale, { dateStyle: "medium", timeZone: "UTC" }),
    [fmtLocale],
  );
  const { data, error, errorInfo, loading, refresh } = useApi<{
    rules: Routine[];
    checks: RoutineCheck[];
    today: string;
  }>("/api/workspace/progress");
  const [date, setDate] = useState(""),
    [open, setOpen] = useState(false),
    [title, setTitle] = useState(""),
    [stage, setStage] = useState<string>(STAGES[0]!),
    [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false);
  const selected = date || data?.today || "",
    rules = data ? scheduledRules(data.rules, selected) : [],
    score = data ? progressScore(data.rules, data.checks, selected) : null;
  const days = data
    ? Array.from({ length: 91 }, (_, i) => {
        const d = new Date(`${data.today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 90 + i);
        const key = d.toISOString().slice(0, 10);
        return { date: key, ...progressScore(data.rules, data.checks, key) };
      })
    : [];
  async function act(body: unknown, method: "POST" | "DELETE" = "POST") {
    setBusy(true);
    try {
      await postJson("/api/workspace/progress", body, method);
      setFailure("");
      refresh();
      return true;
    } catch (e) {
      setFailure(e instanceof Error ? formatApiError(t, e) : t("saveFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <FilterBar
        title={t("title")}
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            {t("addRoutine")}
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        {(error || failure) && (
          <p role="alert" className="text-sm text-destructive">
            {error ? formatApiError(tErrors, errorInfo ?? error) : failure}
          </p>
        )}
        {loading && !data && (
          <p role="status" className="text-sm text-muted-foreground">
            {tCommon("loading.page")}
          </p>
        )}
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-6 py-6">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <p className="text-xs text-muted-foreground">{t("dailyCompletion")}</p>
                <p className="text-4xl font-semibold">
                  {score?.score == null ? "-" : `${Math.round(score.score * 100)}%`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("completedOf", {
                    completed: score?.completed ?? 0,
                    total: score?.total ?? 0,
                  })}
                </p>
              </div>
              <Field label={t("reviewDate")}>
                <DatePicker
                  label={t("progressDate")}
                  value={selected}
                  max={data?.today}
                  onValueChange={setDate}
                />
              </Field>
            </div>
            <ReviewExport
              document={{
                title: t("exportTitle", { date: selected }),
                lines: [
                  t("exportCompleted", {
                    completed: score?.completed ?? 0,
                    total: score?.total ?? 0,
                  }),
                  ...rules.map((r) =>
                    t("exportRoutineLine", {
                      marker: data?.checks.some(
                        (c) => c.date === selected && c.ruleId === r.id && c.done,
                      )
                        ? t("exportDone")
                        : t("exportPending"),
                      stage: stageLabel(r.stage),
                      title: r.title,
                    }),
                  ),
                ],
              }}
            />
          </CardContent>
        </Card>
        <div className="grid gap-4 xl:grid-cols-3">
          {STAGES.map((s) => (
            <Card key={s}>
              <CardHeader>
                <CardTitle>{stageLabel(s)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {rules
                  .filter((r) => r.stage === s)
                  .map((r) => (
                    <div key={r.id} className="flex items-start justify-between gap-2">
                      <label className="flex items-start gap-3 text-sm">
                        <Checkbox
                          className="mt-1"
                          checked={
                            data?.checks.some(
                              (c) => c.ruleId === r.id && c.date === selected && c.done,
                            ) ?? false
                          }
                          disabled={busy || selected > (data?.today ?? "")}
                          onCheckedChange={(checked) =>
                            void act({ ruleId: r.id, date: selected, done: checked === true })
                          }
                        />
                        {r.title}
                      </label>
                      {!r.archivedAt && (
                        <button
                          className="text-xs text-muted-foreground underline"
                          onClick={() => {
                            if (confirm(t("archiveConfirm", { title: r.title })))
                              void act({ id: r.id }, "DELETE");
                          }}
                        >
                          {t("archive")}
                        </button>
                      )}
                    </div>
                  ))}
                {!rules.some((r) => r.stage === s) && (
                  <p className="text-xs text-muted-foreground">{t("noRoutines")}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("recentWeeks")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto">
              {days.map((d) => (
                <HoverHint
                  key={d.date}
                  heading={dayHeading.format(new Date(`${d.date}T12:00:00Z`))}
                  content={t("dayHint", { completed: d.completed, total: d.total })}
                >
                  <button
                    key={d.date}
                    aria-label={t("dayAria", {
                      date: d.date,
                      completed: d.completed,
                      total: d.total,
                    })}
                    onClick={() => setDate(d.date)}
                    className={`min-h-7 min-w-7 rounded border ${selected === d.date ? "border-foreground" : "border-transparent"}`}
                    style={{
                      background:
                        d.score === null
                          ? "var(--muted)"
                          : `color-mix(in srgb, var(--brand) ${15 + d.score * 75}%, var(--card))`,
                    }}
                  />
                </HoverHint>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t("heatmapLegend")}</p>
          </CardContent>
        </Card>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("addRoutineTitle")}</DialogTitle>
            </DialogHeader>
            <Field label={t("routineLabel")}>
              <input
                className={fieldClass}
                value={title}
                placeholder={t("routinePlaceholder")}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label={t("whenLabel")}>
              <OptionSelect
                className={fieldClass}
                value={stage}
                onValueChange={(next) => setStage(next)}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </OptionSelect>
            </Field>
            <div className="flex flex-wrap gap-3">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <label key={i} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={weekdays.includes(i)}
                    onCheckedChange={(checked) =>
                      setWeekdays(
                        checked === true ? [...weekdays, i] : weekdays.filter((n) => n !== i),
                      )
                    }
                  />
                  {weekdayLabel(i, fmtLocale)}
                </label>
              ))}
            </div>
            {failure && (
              <p role="alert" className="text-xs text-destructive">
                {failure}
              </p>
            )}
            <Button
              disabled={!title.trim() || !weekdays.length || busy}
              onClick={async () => {
                if (await act({ title, stage, weekdays })) {
                  setOpen(false);
                  setTitle("");
                }
              }}
            >
              {t("addRoutine")}
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
