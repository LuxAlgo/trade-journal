"use client";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { CandlestickChart, ChevronDown, FileText, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { fieldClass } from "@/components/filter-fields";
import { postJson, useApi } from "@/lib/use-api";
import { formatInlineSelection, remarkRepairSpacedEmphasis } from "@/lib/note-formatting";
import { tradeLinkLabel, tradeMarkdownLink, type LinkableTrade } from "@/lib/trade-links";
import {
  analysisEditPath,
  analysisIdFromSrc,
  analysisLabel,
  analysisMarkdown,
  type ChartAnalysisSummary,
} from "@/lib/chart-analysis";
export function Markdown({ children }: { children: string }) {
  return (
    <div className="journal-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkRepairSpacedEmphasis]}
        components={{
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) =>
            href?.startsWith("/trades/") || href?.startsWith("/charts") ? (
              <Link href={href}>{children}</Link>
            ) : (
              <a href={href}>{children}</a>
            ),
          img: ({ src, alt }) => (
            <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt ?? ""} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
/**
 * Images render inline. A saved chart analysis becomes a figure that opens the chart for
 * editing. Spans keep it valid inside the paragraph Markdown wraps images in.
 */
function MarkdownImage({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const id = analysisIdFromSrc(src);
  if (!id) return <img src={src} alt={alt} loading="lazy" className="max-w-full rounded-md" />;
  const caption = alt.replace(/ chart analysis$/, "") || "Chart analysis";
  return (
    <span className="journal-analysis-embed my-2 block overflow-hidden rounded-lg border bg-card">
      {failed ? (
        <span className="block p-4 text-sm text-muted-foreground">
          This chart snapshot is unavailable. The analysis may have been deleted or saved without an
          image.
        </span>
      ) : (
        <Link
          href={analysisEditPath(id)}
          className="block"
          aria-label={`Open ${caption} in Charts`}
        >
          <img
            src={src}
            alt={alt}
            loading="lazy"
            onError={() => setFailed(true)}
            className="block h-auto w-full"
          />
        </Link>
      )}
      <span className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <CandlestickChart aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{caption}</span>
        </span>
        <Link href={analysisEditPath(id)} className="shrink-0 underline">
          Open in Charts
        </Link>
      </span>
    </span>
  );
}
const BUILT_INS = [
  {
    id: "pre",
    name: "Pre-market plan",
    content:
      "## Market context\n\n## Setups to watch\n\n## Risk limits\n- [ ] Confirm daily risk limit\n- [ ] Check scheduled events\n\n## My intention\n",
  },
  {
    id: "review",
    name: "Trade review",
    content: "## Setup and thesis\n\n## Execution\n\n## What worked\n\n## What I will change\n",
  },
  {
    id: "weekly",
    name: "Weekly review",
    content:
      "## Wins this week\n\n## Repeated mistakes\n\n## Rules I followed\n\n## One improvement for next week\n",
  },
];
export interface RichEditorHandle {
  focus(): void;
}
export function RichEditor({
  value,
  onChange,
  placeholder = "Write your review…",
  defaultMode,
  mode,
  onModeChange,
  showModeToggle = true,
  editorRef,
  analysisDay,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  defaultMode?: "preview" | "edit";
  mode?: "preview" | "edit";
  onModeChange?: (mode: "preview" | "edit") => void;
  showModeToggle?: boolean;
  editorRef?: Ref<RichEditorHandle>;
  /** Journal day a new chart analysis started from this editor should belong to. */
  analysisDay?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null),
    [localPreview, setLocalPreview] = useState(() =>
      defaultMode ? defaultMode === "preview" : Boolean(value.trim()),
    ),
    [error, setError] = useState("");
  const preview = mode ? mode === "preview" : localPreview;
  const setPreview = (next: boolean) => {
    setLocalPreview(next);
    onModeChange?.(next ? "preview" : "edit");
  };
  useImperativeHandle(editorRef, () => ({
    focus() {
      setPreview(false);
      requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.setSelectionRange(value.length, value.length);
      });
    },
  }));
  const { data, refresh } = useApi<{ templates: { id: string; name: string; content: string }[] }>(
    "/api/workspace/templates",
  );
  const [linkOpen, setLinkOpen] = useState(false),
    [search, setSearch] = useState("");
  const {
    data: trades,
    error: tradeError,
    loading: tradesLoading,
  } = useApi<{
    trades: LinkableTrade[];
    hasMore: boolean;
  }>(linkOpen ? `/api/trades/lookup?q=${encodeURIComponent(search)}` : null);
  const [chartsOpen, setChartsOpen] = useState(false);
  const { data: analyses, error: analysesError } = useApi<{ analyses: ChartAnalysisSummary[] }>(
    chartsOpen ? "/api/analyses" : null,
  );
  function insert(before: string, after = "") {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length,
      end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + before + value.slice(start, end) + after + value.slice(end));
    setPreview(false);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(start + before.length, end + before.length);
    });
  }
  /** Insert at the cursor (or the end), then preview so the embedded chart shows. */
  function insertChart(analysis: ChartAnalysisSummary) {
    const at = preview ? value.length : (ref.current?.selectionEnd ?? value.length);
    const before = value.slice(0, at);
    const embed = `${before && !before.endsWith("\n") ? "\n\n" : before ? "\n" : ""}${analysisMarkdown(analysis)}\n`;
    onChange(before + embed + value.slice(at));
    setPreview(true);
  }
  function formatInline(marker: "*" | "**") {
    const next = formatInlineSelection(
      value,
      ref.current?.selectionStart ?? value.length,
      ref.current?.selectionEnd ?? value.length,
      marker,
    );
    onChange(next.value);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {showModeToggle && (
          <Button type="button" variant="outline" size="sm" onClick={() => setPreview(!preview)}>
            {preview ? "Edit" : "Preview"}
          </Button>
        )}
        {!preview && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => formatInline("**")}
              aria-label="Bold"
            >
              B
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => formatInline("*")}
              aria-label="Italic"
            >
              <i>I</i>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => insert("\n## ")}
              aria-label="Heading"
            >
              H2
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => insert("\n- ")}
              aria-label="Bullet list"
            >
              List
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => insert("\n- [ ] ")}
              aria-label="Checklist"
            >
              Checklist
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLinkOpen(!linkOpen)}>
              Link trade
            </Button>
            <DropdownMenu open={chartsOpen} onOpenChange={setChartsOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Insert chart analysis"
                  className="gap-1.5"
                >
                  <CandlestickChart className="size-3.5" />
                  Chart
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                aria-label="Chart analyses"
                className="max-h-80 w-72 overflow-y-auto"
              >
                <DropdownMenuItem asChild>
                  <Link href={analysisDay ? `/charts?day=${analysisDay}` : "/charts"}>
                    <Plus aria-hidden="true" className="size-3.5 shrink-0" />
                    New chart analysis…
                  </Link>
                </DropdownMenuItem>
                {analysesError && (
                  <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
                    {analysesError}
                  </p>
                )}
                {!analyses && !analysesError && (
                  <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
                    Loading analyses…
                  </p>
                )}
                {analyses?.analyses.map((analysis) => (
                  <DropdownMenuItem key={analysis.id} onSelect={() => insertChart(analysis)}>
                    <CandlestickChart
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">{analysisLabel(analysis)}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {analysis.dayDate ?? analysis.updatedAt.slice(0, 10)}
                    </span>
                  </DropdownMenuItem>
                ))}
                {analyses?.analyses.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    No saved analyses yet.
                  </p>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Insert note template"
                  className="gap-2 rounded-lg"
                >
                  Insert template…
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" aria-label="Note templates">
                {[...BUILT_INS, ...(data?.templates ?? [])].map((template) => (
                  <DropdownMenuItem
                    key={template.id}
                    onSelect={() => onChange(value + (value ? "\n\n" : "") + template.content)}
                  >
                    <FileText
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    {template.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!value}
              onClick={async () => {
                const name = prompt("Name this note template");
                if (!name) return;
                try {
                  await postJson("/api/workspace/templates", { name, content: value });
                  refresh();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Save template
            </Button>
          </>
        )}
      </div>
      {linkOpen && !preview && (
        <div className="space-y-2 rounded-md border p-2">
          <input
            aria-label="Find trade by symbol, date or account"
            placeholder="Search symbol, date or account"
            className={fieldClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-40 overflow-y-auto">
            {tradesLoading && (
              <p role="status" className="text-xs text-muted-foreground">
                Loading trades…
              </p>
            )}
            {tradeError && (
              <p role="alert" className="text-xs text-destructive">
                {tradeError}
              </p>
            )}
            {!tradesLoading &&
              !tradeError &&
              trades?.trades.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="block w-full rounded p-1 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    onChange(value + `\n${tradeMarkdownLink(t)}\n`);
                    setLinkOpen(false);
                    setPreview(true);
                  }}
                >
                  {tradeLinkLabel(t)}
                </button>
              ))}
            {!tradesLoading && !tradeError && trades?.trades.length === 0 && (
              <p className="text-xs text-muted-foreground">No matching trades.</p>
            )}
            {!tradesLoading && !tradeError && trades?.hasMore && (
              <p className="text-xs text-muted-foreground">
                Showing the latest 50 matches. Search by date or account to find older trades.
              </p>
            )}
          </div>
        </div>
      )}
      {preview ? (
        <div className="min-h-40 rounded-md border p-3">
          <Markdown>{value || "Nothing written yet."}</Markdown>
        </div>
      ) : (
        <textarea
          ref={ref}
          aria-label="Review notes"
          className={`${fieldClass} min-h-48 resize-y font-mono text-[13px]`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
