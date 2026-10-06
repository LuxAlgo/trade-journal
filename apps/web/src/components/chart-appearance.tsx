"use client";

import { useState } from "react";
import { Plus, RotateCcw, SlidersHorizontal, Star, Trash2, X } from "lucide-react";
import {
  BUILT_IN_TEMPLATES,
  JOURNAL_TIME_ZONE,
  MAX_TEMPLATES,
  TOOL_DEFAULTS,
  effectiveStyle,
  mergeStyle,
  styleValue,
  withStyleValue,
  type ChartPreferences,
  type ChartTemplate,
  type LineStyle,
  type StyleDiff,
  type SymbolPrefs,
  type TextSize,
  type ToolStyle,
} from "@/lib/chart-preferences";
import { RESOLUTIONS, type Resolution } from "@/lib/market-data";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const CHART_TYPES = [
  ["candles", "Candles"],
  ["heikinashi", "Heikin Ashi"],
  ["bars", "OHLC bars"],
  ["line", "Line"],
  ["area", "Area"],
  ["baseline", "Baseline"],
] as const;

const SCALE_MODES = [
  ["price", "Regular"],
  ["percent", "Percent"],
  ["indexed", "Indexed to 100"],
  ["log", "Logarithmic"],
] as const;

const ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Australia/Sydney",
];

/**
 * Chart appearance and behaviour: looks (colours, chart type, scale, canvas), saved looks,
 * per-symbol settings, drawing tool defaults and the defaults every chart opens with.
 * Every change applies to the open chart at once and is saved on the journal server.
 */
export function ChartAppearance({
  open,
  onOpenChange,
  prefs,
  onChange,
  symbolKey,
  symbol,
  base,
  journalTimeZone,
  onOpenVelaSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: ChartPreferences;
  onChange: (next: ChartPreferences) => void;
  symbolKey: string | null;
  symbol: string | null;
  /** The theme defaults of the open chart, to show values you have not changed. */
  base: unknown;
  journalTimeZone: string;
  onOpenVelaSettings: () => void;
}) {
  const [templateName, setTemplateName] = useState("");
  const symbolPrefs: SymbolPrefs = (symbolKey && prefs.symbols[symbolKey]) || {};
  const symbolScope = Boolean(symbolKey && symbolPrefs.style);
  const scopeStyle = symbolScope ? symbolPrefs.style! : prefs.style;
  const effective = effectiveStyle(prefs, symbolKey);
  const shown = mergeStyle((base ?? {}) as StyleDiff, effective);
  const value = (path: string) => styleValue(shown, path);

  const setSymbol = (patch: Partial<SymbolPrefs> | null) => {
    if (!symbolKey) return;
    const symbols = { ...prefs.symbols };
    if (patch === null) delete symbols[symbolKey];
    else {
      const next: SymbolPrefs = { ...symbols[symbolKey], ...patch };
      for (const key of Object.keys(next) as (keyof SymbolPrefs)[])
        if (next[key] === undefined) delete next[key];
      if (Object.keys(next).length) symbols[symbolKey] = next;
      else delete symbols[symbolKey];
    }
    onChange({ ...prefs, symbols });
  };
  /** Replace the look being edited (this symbol's own, or the default one). */
  const setScopeStyle = (style: StyleDiff) =>
    symbolScope ? setSymbol({ style }) : onChange({ ...prefs, style });
  const set = (path: string, v: string | number | boolean) =>
    setScopeStyle(withStyleValue(scopeStyle, path, v));
  const setMany = (entries: [string, string | number | boolean][]) =>
    setScopeStyle(entries.reduce((style, [path, v]) => withStyleValue(style, path, v), scopeStyle));

  const templates = [...BUILT_IN_TEMPLATES, ...prefs.templates];
  const saveTemplate = () => {
    const name = templateName.trim().slice(0, 60);
    if (!name || prefs.templates.length >= MAX_TEMPLATES) return;
    const template: ChartTemplate = {
      id: `look-${Date.now().toString(36)}`,
      name,
      style: effective,
    };
    onChange({ ...prefs, templates: [...prefs.templates, template] });
    setTemplateName("");
  };

  const scale = value("priceScale.log") ? "log" : String(value("priceScale.mode") ?? "price");
  const defaults = prefs.defaults;
  const setDefaults = (patch: Partial<ChartPreferences["defaults"]>) =>
    onChange({ ...prefs, defaults: { ...defaults, ...patch } });
  const setTool = (type: string, patch: Partial<ToolStyle> | null) => {
    const tools = { ...prefs.tools };
    if (patch === null) delete tools[type];
    else tools[type] = { ...tools[type], ...patch };
    onChange({ ...prefs, tools });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,900px)] max-w-3xl overflow-y-auto">
        <DialogTitle>Chart appearance</DialogTitle>
        <DialogDescription>
          Changes apply to the chart at once and are saved for every browser.
        </DialogDescription>
        <Tabs defaultValue="look">
          <TabsList className="flex-wrap">
            <TabsTrigger value="look">Look</TabsTrigger>
            <TabsTrigger value="symbol" disabled={!symbolKey}>
              Symbol
            </TabsTrigger>
            <TabsTrigger value="drawings">Drawings</TabsTrigger>
            <TabsTrigger value="defaults">Defaults</TabsTrigger>
          </TabsList>

          <TabsContent value="look" className="space-y-4 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-accent/30 px-3 py-2 text-sm">
              <span>
                Editing{" "}
                <strong>
                  {symbolScope ? `the look of ${symbol} only` : "the look of every chart"}
                </strong>
                {symbolScope ? "" : symbol ? ` (${symbol} has no look of its own)` : ""}.
              </span>
              {symbolKey && (
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={symbolScope}
                    onChange={(e) => setSymbol({ style: e.target.checked ? {} : undefined })}
                  />
                  Own look for {symbol}
                </label>
              )}
            </div>

            <Section title="Looks">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {templates.map((template) => {
                  const look = mergeStyle((base ?? {}) as StyleDiff, template.style);
                  const saved = !template.id.startsWith("builtin-");
                  return (
                    <div key={template.id} className="relative">
                      <button
                        type="button"
                        onClick={() => setScopeStyle(template.style)}
                        className="flex w-full flex-col gap-1 rounded-md border p-2 text-left text-xs hover:bg-accent"
                      >
                        <LookPreview look={look} />
                        <span className="truncate">{template.name}</span>
                      </button>
                      {saved && (
                        <button
                          type="button"
                          aria-label={`Delete the look ${template.name}`}
                          className="absolute right-1 top-1 rounded bg-background/80 p-0.5 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            onChange({
                              ...prefs,
                              templates: prefs.templates.filter((t) => t.id !== template.id),
                            })
                          }
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input
                  value={templateName}
                  maxLength={60}
                  onChange={(e) => setTemplateName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveTemplate()}
                  placeholder="Name this look to reuse it"
                  aria-label="Name for the current look"
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!templateName.trim()}
                  onClick={saveTemplate}
                >
                  <Plus /> Save look
                </Button>
              </div>
            </Section>

            <div className="grid gap-4 sm:grid-cols-2">
              <Section title="Series">
                <Field label="Chart type">
                  <select
                    value={String(value("series.style") ?? "candles")}
                    onChange={(e) => set("series.style", e.target.value)}
                    className={selectClass}
                  >
                    {CHART_TYPES.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Rising">
                  <ColorInput
                    value={value("candles.upColor")}
                    onChange={(c) =>
                      setMany([
                        ["candles.upColor", c],
                        ["candles.borderUpColor", c],
                        ["candles.wickUpColor", c],
                        ["bars.upColor", c],
                        ["baseline.topLineColor", c],
                      ])
                    }
                  />
                </Field>
                <Field label="Falling">
                  <ColorInput
                    value={value("candles.downColor")}
                    onChange={(c) =>
                      setMany([
                        ["candles.downColor", c],
                        ["candles.borderDownColor", c],
                        ["candles.wickDownColor", c],
                        ["bars.downColor", c],
                        ["baseline.bottomLineColor", c],
                      ])
                    }
                  />
                </Field>
                <Toggle
                  label="Filled bodies"
                  checked={value("candles.bodyVisible") !== false}
                  onChange={(v) => set("candles.bodyVisible", v)}
                />
                <Toggle
                  label="Borders"
                  checked={value("candles.borderVisible") === true}
                  onChange={(v) => set("candles.borderVisible", v)}
                />
                <Toggle
                  label="Wicks"
                  checked={value("candles.wickVisible") !== false}
                  onChange={(v) => set("candles.wickVisible", v)}
                />
                <Field label="Line colour">
                  <ColorInput
                    value={value("line.color")}
                    onChange={(c) =>
                      setMany([
                        ["line.color", c],
                        ["area.lineColor", c],
                      ])
                    }
                  />
                </Field>
                <Field label="Line width">
                  <NumberInput
                    min={1}
                    max={6}
                    value={value("line.width")}
                    onChange={(n) =>
                      setMany([
                        ["line.width", n],
                        ["area.width", n],
                      ])
                    }
                  />
                </Field>
              </Section>

              <Section title="Canvas">
                <Field label="Background">
                  <ColorInput
                    value={value("layout.background")}
                    onChange={(c) => set("layout.background", c)}
                  />
                </Field>
                <Field label="Text">
                  <ColorInput
                    value={value("layout.textColor")}
                    onChange={(c) => set("layout.textColor", c)}
                  />
                </Field>
                <Field label="Text size">
                  <NumberInput
                    min={8}
                    max={18}
                    value={value("layout.fontSize")}
                    onChange={(n) => set("layout.fontSize", n)}
                  />
                </Field>
                <Field label="Grid">
                  <span className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={value("grid.vertLines.visible") !== false}
                        onChange={(e) => set("grid.vertLines.visible", e.target.checked)}
                      />
                      Vertical
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={value("grid.horzLines.visible") !== false}
                        onChange={(e) => set("grid.horzLines.visible", e.target.checked)}
                      />
                      Horizontal
                    </label>
                    <ColorInput
                      value={value("grid.horzLines.color")}
                      onChange={(c) =>
                        setMany([
                          ["grid.horzLines.color", c],
                          ["grid.vertLines.color", c],
                        ])
                      }
                    />
                  </span>
                </Field>
                <Field label="Crosshair">
                  <span className="flex items-center gap-2">
                    <ColorInput
                      value={value("crosshair.color")}
                      onChange={(c) => set("crosshair.color", c)}
                    />
                    <select
                      aria-label="Crosshair line"
                      value={String(value("crosshair.style") ?? "dashed")}
                      onChange={(e) => set("crosshair.style", e.target.value)}
                      className={selectClass}
                    >
                      <option value="solid">Solid</option>
                      <option value="dashed">Dashed</option>
                      <option value="dotted">Dotted</option>
                    </select>
                  </span>
                </Field>
              </Section>

              <Section title="Price scale">
                <Field label="Scale">
                  <select
                    value={scale}
                    onChange={(e) =>
                      e.target.value === "log"
                        ? setMany([
                            ["priceScale.mode", "price"],
                            ["priceScale.log", true],
                          ])
                        : setMany([
                            ["priceScale.mode", e.target.value],
                            ["priceScale.log", false],
                          ])
                    }
                    className={selectClass}
                  >
                    {SCALE_MODES.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Toggle
                  label="Invert scale"
                  checked={value("priceScale.invert") === true}
                  onChange={(v) => set("priceScale.invert", v)}
                />
                <Toggle
                  label="Last price line"
                  checked={value("priceScale.currentPriceLine") !== false}
                  onChange={(v) => set("priceScale.currentPriceLine", v)}
                />
                <Toggle
                  label="Last price label"
                  checked={value("priceScale.priceLabel") !== false}
                  onChange={(v) => set("priceScale.priceLabel", v)}
                />
                <Toggle
                  label="Candle countdown"
                  checked={value("priceScale.countdown") !== false}
                  onChange={(v) => set("priceScale.countdown", v)}
                />
              </Section>

              <Section title="Motion">
                <Toggle
                  label="Animations (zoom, pan, autoscale)"
                  checked={value("animations.zoom") !== false}
                  onChange={(v) =>
                    setMany([
                      ["animations.zoom", v],
                      ["animations.pan", v],
                      ["animations.autoscale", v],
                      ["animations.intro", v],
                    ])
                  }
                />
              </Section>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setScopeStyle({})}>
                <RotateCcw /> Back to the theme default
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onOpenVelaSettings}>
                <SlidersHorizontal /> Every chart setting…
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Settings you never changed follow the light or dark theme. Changes made in
              <strong> Every chart setting</strong> are saved to the same look.
            </p>
          </TabsContent>

          <TabsContent value="symbol" className="space-y-4 pt-3">
            {symbolKey && (
              <>
                <Section title={symbol ?? "Symbol"}>
                  <Field label="Display name">
                    <input
                      value={symbolPrefs.label ?? ""}
                      maxLength={60}
                      placeholder={symbol ?? ""}
                      onChange={(e) => setSymbol({ label: e.target.value || undefined })}
                      className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                    />
                  </Field>
                  <Field label="Colour tag">
                    <span className="flex items-center gap-2">
                      <ColorInput
                        value={symbolPrefs.color}
                        onChange={(c) => setSymbol({ color: c })}
                      />
                      {symbolPrefs.color && (
                        <button
                          type="button"
                          className="text-xs underline"
                          onClick={() => setSymbol({ color: undefined })}
                        >
                          None
                        </button>
                      )}
                    </span>
                  </Field>
                  <Toggle
                    label="In the watchlist"
                    icon={<Star className="size-3.5" />}
                    checked={symbolPrefs.favorite === true}
                    onChange={(v) => setSymbol({ favorite: v || undefined })}
                  />
                  <Field label="Opens with">
                    <select
                      value={symbolPrefs.resolution ?? ""}
                      onChange={(e) =>
                        setSymbol({
                          resolution: (e.target.value || undefined) as Resolution | undefined,
                        })
                      }
                      className={selectClass}
                    >
                      <option value="">The default candle size</option>
                      {(Object.keys(RESOLUTIONS) as Resolution[]).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Price decimals">
                    <select
                      value={symbolPrefs.decimals === undefined ? "" : String(symbolPrefs.decimals)}
                      onChange={(e) =>
                        setSymbol({
                          decimals: e.target.value === "" ? undefined : Number(e.target.value),
                        })
                      }
                      className={selectClass}
                    >
                      <option value="">Automatic</option>
                      {Array.from({ length: 9 }, (_, i) => (
                        <option key={i} value={i}>
                          {i} {i === 0 ? "(whole numbers)" : `(${(0).toFixed(i)})`}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Toggle
                    label="Own look (edit it in the Look tab)"
                    checked={symbolScope}
                    onChange={(v) => setSymbol({ style: v ? {} : undefined })}
                  />
                </Section>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setSymbol(null)}
                >
                  <Trash2 /> Forget {symbol}&apos;s settings
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="drawings" className="space-y-4 pt-3">
            <Toggle
              label="Remember the last style I use with each tool"
              checked={defaults.rememberToolStyles}
              onChange={(v) => setDefaults({ rememberToolStyles: v })}
            />
            <p className="text-xs text-muted-foreground">
              New drawings start with these styles. The pen and highlighter use the ink chosen on
              the toolbar; other quick tools use it too until you set their own colour here.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">Tool</th>
                    <th className="font-medium">Colour</th>
                    <th className="font-medium">Width</th>
                    <th className="font-medium">Line</th>
                    <th className="font-medium">Fill</th>
                    <th className="font-medium">Text</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {TOOL_DEFAULTS.map((tool) => {
                    const style = prefs.tools[tool.type] ?? {};
                    return (
                      <tr key={tool.type} className="border-t">
                        <td className="py-1 pr-2">{tool.label}</td>
                        <td>
                          <ColorInput
                            value={style.lineColor}
                            onChange={(c) => setTool(tool.type, { lineColor: c })}
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`${tool.label} width`}
                            value={style.lineWidth ?? ""}
                            onChange={(e) =>
                              setTool(tool.type, {
                                lineWidth: e.target.value ? Number(e.target.value) : undefined,
                              })
                            }
                            className={selectClass}
                          >
                            <option value="">Auto</option>
                            {[1, 2, 3, 4, 5, 6].map((w) => (
                              <option key={w} value={w}>
                                {w}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            aria-label={`${tool.label} line style`}
                            value={style.lineStyle ?? ""}
                            onChange={(e) =>
                              setTool(tool.type, {
                                lineStyle: (e.target.value || undefined) as LineStyle | undefined,
                              })
                            }
                            className={selectClass}
                          >
                            <option value="">Auto</option>
                            <option value="solid">Solid</option>
                            <option value="dashed">Dashed</option>
                            <option value="dotted">Dotted</option>
                          </select>
                        </td>
                        <td>
                          {tool.fill && (
                            <span className="flex items-center gap-1">
                              <ColorInput
                                value={style.fillColor}
                                onChange={(c) => setTool(tool.type, { fillColor: c })}
                              />
                              <select
                                aria-label={`${tool.label} fill opacity`}
                                value={style.fillOpacity ?? ""}
                                onChange={(e) =>
                                  setTool(tool.type, {
                                    fillOpacity:
                                      e.target.value === "" ? undefined : Number(e.target.value),
                                  })
                                }
                                className={selectClass}
                              >
                                <option value="">Auto</option>
                                {[0, 0.1, 0.2, 0.3, 0.5, 0.8].map((o) => (
                                  <option key={o} value={o}>
                                    {Math.round(o * 100)}%
                                  </option>
                                ))}
                              </select>
                            </span>
                          )}
                        </td>
                        <td>
                          {tool.text && (
                            <span className="flex items-center gap-1">
                              <ColorInput
                                value={style.textColor}
                                onChange={(c) => setTool(tool.type, { textColor: c })}
                              />
                              <select
                                aria-label={`${tool.label} text size`}
                                value={style.textSize ?? ""}
                                onChange={(e) =>
                                  setTool(tool.type, {
                                    textSize: (e.target.value || undefined) as TextSize | undefined,
                                  })
                                }
                                className={selectClass}
                              >
                                <option value="">Auto</option>
                                {["tiny", "small", "normal", "large", "huge"].map((size) => (
                                  <option key={size} value={size}>
                                    {size}
                                  </option>
                                ))}
                              </select>
                            </span>
                          )}
                        </td>
                        <td>
                          {prefs.tools[tool.type] && (
                            <button
                              type="button"
                              aria-label={`Reset ${tool.label}`}
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => setTool(tool.type, null)}
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {Object.keys(prefs.tools).some(
              (type) => !TOOL_DEFAULTS.some((t) => t.type === type),
            ) && (
              <p className="text-xs text-muted-foreground">
                Also remembered for:{" "}
                {Object.keys(prefs.tools)
                  .filter((type) => !TOOL_DEFAULTS.some((t) => t.type === type))
                  .map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="mr-2 underline"
                      onClick={() => setTool(type, null)}
                      title="Forget"
                    >
                      {type} ✕
                    </button>
                  ))}
              </p>
            )}
            {prefs.palette.length > 0 && (
              <Section title="Your ink colours">
                <div className="flex flex-wrap gap-2">
                  {prefs.palette.map((color) => (
                    <span key={color} className="flex items-center gap-1 text-xs">
                      <span
                        className="size-5 rounded-full border"
                        style={{ backgroundColor: color }}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ink ${color}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          onChange({ ...prefs, palette: prefs.palette.filter((c) => c !== color) })
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </Section>
            )}
          </TabsContent>

          <TabsContent value="defaults" className="space-y-4 pt-3">
            <Section title="New charts">
              <Field label="Candle size">
                <select
                  value={defaults.resolution}
                  onChange={(e) => setDefaults({ resolution: e.target.value as Resolution })}
                  className={selectClass}
                >
                  {(Object.keys(RESOLUTIONS) as Resolution[]).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
              <Toggle
                label="Open live (streaming)"
                checked={defaults.live}
                onChange={(v) => setDefaults({ live: v })}
              />
              <Toggle
                label="Volume"
                checked={defaults.volume}
                onChange={(v) => setDefaults({ volume: v })}
              />
              <Field label="Time axis">
                <select
                  value={defaults.timeZone}
                  onChange={(e) => setDefaults({ timeZone: e.target.value })}
                  className={selectClass}
                >
                  <option value={JOURNAL_TIME_ZONE}>Journal timezone ({journalTimeZone})</option>
                  {ZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                  {defaults.timeZone !== JOURNAL_TIME_ZONE &&
                    !ZONES.includes(defaults.timeZone) && (
                      <option value={defaults.timeZone}>{defaults.timeZone}</option>
                    )}
                </select>
              </Field>
            </Section>
            <Section title="Drawing">
              <Field label="Magnet">
                <select
                  value={defaults.magnet}
                  onChange={(e) =>
                    setDefaults({
                      magnet: e.target.value as ChartPreferences["defaults"]["magnet"],
                    })
                  }
                  className={selectClass}
                >
                  <option value="off">Off</option>
                  <option value="weak">Weak (snap near candles)</option>
                  <option value="strong">Strong (always snap to OHLC)</option>
                </select>
              </Field>
              <Toggle
                label="Keep the tool after drawing"
                checked={defaults.stayInDrawingMode}
                onChange={(v) => setDefaults({ stayInDrawingMode: v })}
              />
            </Section>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

const selectClass = "h-8 rounded-md border bg-background px-1.5 text-xs";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="shrink-0">{label}</span>
      <span className="flex min-w-0 justify-end">{children}</span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {icon}
      {label}
    </label>
  );
}

const hex = (value: unknown) => {
  if (typeof value !== "string") return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map((c) => c + c).join("")}`;
  if (/^#[0-9a-f]{8}$/i.test(value)) return value.slice(0, 7);
  const rgb = value.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return rgb
    ? `#${rgb
        .slice(1, 4)
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("")}`
    : "#000000";
};

function ColorInput({ value, onChange }: { value: unknown; onChange: (color: string) => void }) {
  const unset = value === undefined;
  return (
    <span
      className="relative inline-flex h-7 w-9 cursor-pointer items-center justify-center overflow-hidden rounded border bg-background"
      title={unset ? "Automatic: click to choose" : String(value)}
    >
      {unset ? (
        <span className="text-[10px] text-muted-foreground">Auto</span>
      ) : (
        <span className="absolute inset-0.5 rounded-sm" style={{ backgroundColor: hex(value) }} />
      )}
      <input
        type="color"
        value={hex(value)}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </span>
  );
}

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: unknown;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={typeof value === "number" ? value : ""}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
      }}
      className="h-8 w-16 rounded-md border bg-background px-2 text-sm"
    />
  );
}

/** A tiny candle strip in the look's colours, over its background. */
function LookPreview({ look }: { look: StyleDiff }) {
  const bg = styleValue(look, "layout.background");
  const up = styleValue(look, "candles.upColor");
  const down = styleValue(look, "candles.downColor");
  const type = styleValue(look, "series.style");
  const hollow = styleValue(look, "candles.bodyVisible") === false;
  const line = styleValue(look, "line.color");
  const bars = [
    [60, 30, up],
    [40, 45, down],
    [55, 25, up],
    [35, 40, down],
    [65, 20, up],
  ] as const;
  return (
    <svg
      viewBox="0 0 60 40"
      className="h-10 w-full rounded"
      style={{ background: typeof bg === "string" ? bg : undefined }}
      aria-hidden="true"
    >
      {type === "line" || type === "area" ? (
        <polyline
          points="5,30 17,18 29,24 41,12 55,16"
          fill="none"
          stroke={typeof line === "string" ? line : "#3b82f6"}
          strokeWidth="2"
        />
      ) : (
        bars.map(([top, h, color], i) => {
          const c = typeof color === "string" ? color : "#888";
          return (
            <g key={i}>
              <line
                x1={8 + i * 11}
                x2={8 + i * 11}
                y1={40 - top - 4}
                y2={40 - top + h + 4}
                stroke={c}
                strokeWidth="1"
              />
              <rect
                x={5 + i * 11}
                y={40 - top}
                width="6"
                height={h / 3}
                fill={hollow ? "none" : c}
                stroke={c}
                strokeWidth="1"
              />
            </g>
          );
        })
      )}
    </svg>
  );
}
