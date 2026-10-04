// @vitest-environment jsdom
// T37: one representative core-flow assertion per supported language, spread
// across the chains from the task list (docs/i18n.md §14): the locale route,
// login, accounts, trades, calendar, journal, import, settings, AI and export
// all work end-to-end through the real seven-locale message catalogs.
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLocale } from "./helpers/i18n";
import { installRadixShims } from "./helpers/jsdom";
import { ApiError } from "../src/lib/api-error";
import type { TradeMetrics } from "@luxalgo/journal-core";
import type { CalendarResponse } from "../src/lib/calendar-insights";

const state = vi.hoisted(() => ({
  // Stable per-endpoint payloads (see tests/i18n-settings.test.ts: a fresh
  // object literal per call re-triggers [data] sync effects forever).
  api: new Map<string, unknown>(),
  post: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

const { cookieJar } = vi.hoisted(() => ({
  cookieJar: {
    get: vi.fn<(name: string) => { value: string } | undefined>(),
    set: vi.fn<(...args: unknown[]) => void>(),
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn(), refresh: state.refresh }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/filter-bar", () => ({
  FilterBar: ({ title, actions }: { title?: string; actions?: ReactNode }) =>
    createElement("div", { "data-testid": "filter-bar", "data-title": title }, actions),
  useFilters: (): {
    values: Record<string, never>;
    query: string;
    range: string;
    timeZone: string;
  } => ({ values: {}, query: "", range: "all", timeZone: "UTC" }),
}));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => state.post(...args),
  useApi: (url: string | null) => ({
    data: url !== null && state.api.has(url) ? state.api.get(url) : null,
    error: null,
    errorInfo: null,
    loading: false,
    refresh: state.refresh,
  }),
}));
vi.mock("@/components/privacy", () => ({
  MonetaryValue: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  MonetaryField: () => createElement("input", { type: "text", readOnly: true }),
  usePrivacy: () => false,
}));
// The real formatAutosaveStatus plus a scripted hook, so the journal day page
// renders the stable saved state through the production formatting path.
vi.mock("@/lib/use-autosave", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/use-autosave")>();
  return {
    ...actual,
    useAutosave: () => ({
      save: vi.fn(),
      status: "Saved",
      saveState: { state: "saved" as const, message: "", errorInfo: null },
      flush: vi.fn(),
    }),
  };
});
// Journal-day-only heavy children; the chains under test never touch them.
vi.mock("@/components/voice-note", () => ({ VoiceNote: () => null }));
vi.mock("@/components/ai-recap", () => ({ AiRecap: () => null }));
vi.mock("@/components/attachments", () => ({ Attachments: () => null }));
vi.mock("@/components/charts/equity-area", () => ({ EquityArea: () => null }));
vi.mock("@/components/manual-trade-entry", () => ({ ManualTradeEntry: () => null }));
vi.mock("@/components/timezone-picker", () => ({ TimeZonePicker: () => null }));
vi.mock("@/components/account-picker", () => ({
  AccountPicker: ({ onChange }: { onChange: (id: string) => void }) =>
    createElement("button", { onClick: () => onChange("test-account") }, "Choose test account"),
}));
// Radix Select as a native select (same stand-in as i18n-accounts.test.ts).
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) =>
    createElement(
      "select",
      {
        value,
        onChange: (event: { target: { value: string } }) => onValueChange(event.target.value),
      },
      children,
    ),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("option", { value }, children),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
// Radix Dialog passthrough so the accounts create form renders inline.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogContent: ({ children }: { children: ReactNode }) => children,
  DialogHeader: ({ children }: { children: ReactNode }) => children,
  DialogTitle: ({ children }: { children: ReactNode }) => children,
  DialogDescription: ({ children }: { children: ReactNode }) => children,
}));
// Export success path without a real canvas or font download (i18n-export pattern).
vi.mock("@/lib/export-review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export-review")>();
  return {
    ...actual,
    exportPdf: () =>
      Promise.resolve([
        { blob: new Blob(["%PDF-fixture"], { type: "application/pdf" }), filename: "review.pdf" },
      ]),
    exportPng: () =>
      Promise.resolve([{ blob: new Blob(["png"], { type: "image/png" }), filename: "review.png" }]),
  };
});

// Radix DropdownMenu (language switcher) needs APIs jsdom does not implement.
beforeAll(installRadixShims);

const { default: LoginPage } = await import("../src/app/login/page");
const { default: AccountsPage } = await import("../src/app/accounts/page");
const { default: TradesPage } = await import("../src/app/trades/page");
const { default: CalendarPage } = await import("../src/app/calendar/page");
const { default: JournalPage } = await import("../src/app/journal/page");
const { default: NotebookPage } = await import("../src/app/notebook/page");
const { default: SettingsPage } = await import("../src/app/settings/page");
const { default: ImportPage } = await import("../src/app/import/page");
const { POST: localePost } = await import("../src/app/api/locale/route");
const { AskJournal } = await import("../src/components/ask-journal");
const { ReviewExport } = await import("../src/components/review-export");
const { TooltipProvider } = await import("../src/components/ui/tooltip");
const { calendarMonthFromDays } = await import("@luxalgo/journal-core");
const { calendarInsights } = await import("../src/lib/calendar-insights");

const cleanups: Array<() => void> = [];
const mount = (ui: ReactElement, locale: string) => {
  const rendered = renderWithLocale(
    createElement(TooltipProvider, { delayDuration: 0, children: ui }),
    {
      locale,
    },
  );
  cleanups.push(rendered.unmount);
  return rendered.container;
};

const setValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};
const buttonByText = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === text)!;
const buttonByAria = (name: string) =>
  Array.from(document.body.querySelectorAll("button")).find(
    (button) => (button.getAttribute("aria-label") ?? "").trim() === name,
  );
const labeledInput = (container: HTMLElement, text: string) => {
  const label = [...container.querySelectorAll("label")].find(
    (candidate) => candidate.textContent === text,
  )!;
  return document.getElementById(label.getAttribute("for")!) as HTMLInputElement;
};

const account = {
  id: "acc-1",
  name: "Main",
  broker: "",
  kind: "manual",
  currency: "USD",
  initialBalance: 1000,
  profitCalcMethod: "fifo",
  autoSync: false,
  lastSyncAt: "2026-10-04T12:30",
  archivedAt: null,
  connected: false,
  snapshot: { equity: 1234.5, positions: [{}, {}] },
};

const tradeRow = (symbol: string, key: string) => ({
  key,
  accountId: "acc-1",
  symbol,
  direction: "long",
  status: "win",
  openedAt: "2026-09-01T10:00:00Z",
  closedAt: "2026-09-01T11:00:00Z",
  quantity: 100,
  avgEntry: 10,
  avgExit: 11,
  grossPnl: 100,
  fees: 1,
  netPnl: 99,
  executionCount: 2,
  durationMs: 3_600_000,
  rating: null,
  tags: [],
  mistakes: [],
  reviewed: false,
});

const metrics = {
  totalTrades: 2,
  closedTrades: 2,
  openTrades: 0,
  wins: 2,
  losses: 0,
  breakevens: 0,
  netPnl: 198,
  grossPnl: 200,
  fees: 2,
  winRate: 1,
  dayWinRate: 1,
  tradingDays: 1,
  profitFactor: null,
  profitFactorIsInfinite: true,
} as unknown as TradeMetrics;

const journalDay = (date: string, trades: number) => ({
  date,
  stats: {
    date,
    netPnl: 120,
    grossPnl: 121,
    fees: 1,
    trades,
    wins: 1,
    losses: trades - 1,
    breakevens: 0,
    volume: 10,
  },
});

const calDay = (date: string, netPnl: number, trades = 2) => ({
  date,
  netPnl,
  grossPnl: netPnl + 1,
  fees: 1,
  trades,
  wins: netPnl > 0 ? Math.min(1, trades) : 0,
  losses: netPnl < 0 ? trades : 0,
  breakevens: 0,
  volume: 10,
});

const calendarMonth = calendarMonthFromDays(
  [calDay("2026-09-04", 120), calDay("2026-09-07", 30, 1)],
  2026,
  9,
);
const calendarResponse: CalendarResponse = {
  calendar: calendarMonth,
  insights: calendarInsights(calendarMonth),
  timeZone: "UTC",
  currencies: ["USD"],
  runningPnl: {},
  scope: { from: "2026-09-01", to: "2026-09-30" },
};

const settingsPayload = {
  timeZone: "UTC",
  importTimeZone: "UTC",
  multipliers: {},
  currencyConversion: { enabled: false, reportingCurrency: "USD", rates: {} },
  aiProvider: "anthropic",
  aiModel: "claude-opus-5",
  aiConfigured: false,
  aiConnections: {
    openai: { configured: false, model: "gpt-4.1-mini", source: null },
    anthropic: { configured: false, model: "claude-opus-5", source: null },
  },
};

const previewPayload = {
  detected: "tradezella",
  timeZone: "UTC",
  warnings: ["TradeZella exports are trade-level; entry/exit executions were reconstructed."],
  diagnostics: [{ code: "trade_level_reconstructed" }],
  totals: {
    executions: 1,
    symbols: 1,
    skippedRows: 2,
    from: "2026-09-01T10:00:00Z",
    to: "2026-09-01T10:00:00Z",
  },
  executions: [
    {
      symbol: "TEST",
      side: "buy",
      quantity: 1,
      price: 100,
      fee: 0,
      executedAt: "2026-09-01T10:00:00Z",
    },
  ],
};

beforeEach(() => {
  state.api.clear();
  state.post.mockReset().mockResolvedValue({ id: "created-test" });
  state.push.mockReset();
  state.refresh.mockReset();
  cookieJar.get.mockReset();
  cookieJar.set.mockReset();
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("i18n core flows (T37, one chain per locale)", () => {
  it("POST /api/locale writes the cookie and rejects invalid input with a coded 400", async () => {
    const call = (body: unknown) =>
      localePost(
        new Request("http://localhost:3000/api/locale", {
          method: "POST",
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      );
    const ok = await call({ locale: "fr" });
    expect(ok.status).toBe(200);
    expect(cookieJar.set).toHaveBeenCalledWith(
      "NEXT_LOCALE",
      "fr",
      expect.objectContaining({ maxAge: 60 * 60 * 24 * 365 }),
    );
    const bad = await call({ locale: "en/common" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Invalid locale", code: "invalid_locale" });
    expect(cookieJar.set).toHaveBeenCalledTimes(1);
  });

  it("en: a wrong password renders the localized errors.wrong_password text", async () => {
    state.post.mockRejectedValueOnce(new ApiError("Wrong password. Try again.", "wrong_password"));
    const container = mount(createElement(LoginPage), "en");
    await setValue(container.querySelector<HTMLInputElement>('input[type="password"]')!, "nope");
    await click(buttonByText(container, "Unlock") ?? container.querySelector("button")!);
    expect(document.body.textContent).toContain("Wrong password. Try again.");
  });

  it("zh-CN: account create and delete confirm speak the localized copy", async () => {
    state.api.set("/api/accounts", { accounts: [account] });
    const container = mount(createElement(AccountsPage), "zh-CN");
    // Machine identity (account name) stays verbatim inside the localized confirm.
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const deleteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="删除账户"]',
    )!;
    expect(deleteButton).toBeTruthy();
    await click(deleteButton);
    expect(confirmSpy).toHaveBeenCalledWith("删除「Main」及其全部交易？此操作无法撤销。");
    expect(state.post).toHaveBeenCalledWith("/api/accounts/acc-1", undefined, "DELETE");

    await click(buttonByText(container, "新建账户"));
    await setValue(labeledInput(container, "账户名称"), "Testing");
    await click(buttonByText(container, "创建账户"));
    expect(state.post).toHaveBeenCalledWith("/api/accounts", {
      name: "Testing",
      kind: "manual",
      currency: "USD",
      initialBalance: 0,
    });
  });

  it("zh-CN: bulk delete confirms the plural copy and machine filter values stay raw", async () => {
    state.api.set("/api/trades?view=list&", {
      trades: [tradeRow("AAPL", "k1"), tradeRow("MSFT", "k2")],
      metrics,
      timeZone: "UTC",
    });
    const container = mount(createElement(TradesPage), "zh-CN");
    // Machine identifiers (symbols) render unchanged next to localized UI.
    expect(container.textContent).toContain("AAPL");
    expect(container.textContent).toContain("MSFT");
    const selectAll = container.querySelector<HTMLButtonElement>(
      'button[aria-label="选择所有匹配的交易"]',
    )!;
    expect(selectAll).toBeTruthy();
    await click(selectAll);
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    await click(buttonByText(container, "删除"));
    expect(confirmSpy).toHaveBeenCalledWith("删除 2 笔交易及其全部成交记录？此操作无法撤销。");
    expect(state.post).not.toHaveBeenCalled();
  });

  it("zh-CN: the six Settings sections and the language switcher are reachable", () => {
    for (const [url, payload] of [
      ["/api/settings", settingsPayload],
      [
        "/api/workspace/defaults",
        { breakeven: 0, breakevenMode: "money", feeRules: [], riskRules: [] },
      ],
      ["/api/accounts", { accounts: [{ id: "a1", name: "Main", currency: "USD" }] }],
      [
        "/api/market-data/connections",
        { connections: [{ id: "alpaca", name: "Alpaca", configured: false, source: null }] },
      ],
      ["/api/market-data/csv", { datasets: [] }],
      ["/api/brokers", { brokers: [] }],
      ["/api/import", { formats: [] }],
    ] as const) {
      state.api.set(url, payload);
    }
    const container = mount(createElement(SettingsPage), "zh-CN");
    const nav = container.querySelector("nav")!;
    for (const label of ["通用", "交易", "汇率换算", "行情数据", "AI", "数据与备份"])
      expect(nav.textContent).toContain(label);
    expect(container.querySelector('button[aria-label="切换语言"]')).not.toBeNull();
  });

  it("ja: calendar month navigation uses the localized aria names and the {n} trades plural", () => {
    state.api.set("/api/calendar?", calendarResponse);
    mount(createElement(CalendarPage), "ja");
    expect(buttonByAria("次の月")).toBeTruthy();
    expect(buttonByAria("前の月")).toBeTruthy();
    expect(document.body.textContent).toContain("1 件のトレード");
    expect(document.body.textContent).not.toContain("1 件のトレードs");
  });

  it("ko: the journal list uses the {n} trades plural and the editor shows the saved state", async () => {
    state.api.set("/api/journal?", { days: [journalDay("2026-09-15", 2)] });
    mount(createElement(JournalPage), "ko");
    expect(document.body.textContent).toContain("거래 2건");
    expect(document.body.textContent).not.toContain("거래 2건s");

    // Autosave status through the notebook editor, a real useAutosave consumer
    // (the /[date] page suspends on React use(params), which never resolves
    // under the jsdom act harness — same reason other tests skip it).
    state.api.set("/api/notes?folder=all&q=", {
      notes: [
        {
          id: "n1",
          folderId: "f1",
          title: "My note",
          content: "hello",
          updatedAt: "2026-09-01T10:00:00Z",
        },
      ],
      folders: [{ id: "f1", name: "Work", kind: "user" }],
    });
    const container = mount(createElement(NotebookPage), "ko");
    const noteButton = Array.from(container.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes("My note"),
    )!;
    await click(noteButton);
    expect(document.body.textContent).toContain("저장됨");
    expect(document.body.textContent).not.toContain("Saved");
  });

  it("zh-TW: import preview diagnostics localize by code while machine fields stay raw", async () => {
    for (const [url, payload] of [
      ["/api/settings", settingsPayload],
      ["/api/brokers", { brokers: [] }],
      ["/api/import", { formats: [] }],
      ["/api/accounts", { accounts: [{ id: "a1", name: "Main", currency: "USD" }] }],
    ] as const) {
      state.api.set(url, payload);
    }
    const container = mount(createElement(ImportPage), "zh-TW");
    state.post.mockResolvedValueOnce(undefined);
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [
          {
            name: "trades.csv",
            size: 10,
            arrayBuffer: async () => new TextEncoder().encode("statement").buffer,
          },
        ],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    state.post.mockResolvedValueOnce(previewPayload);
    await click(buttonByText(container, "預覽檔案"));
    // The warning renders through its diagnostic code, not the English original.
    expect(container.textContent).toContain("該匯出按整筆交易記錄，開倉與平倉成交由報告價格重建。");
    expect(container.textContent).not.toContain("TradeZella exports are trade-level");
    // Machine fields stay locale-independent.
    expect(container.textContent).toContain("tradezella");
    expect(container.textContent).toContain("TEST · BUY");
  });

  it("es: an unconfigured AI renders the localized setup notice", async () => {
    state.post.mockRejectedValueOnce(
      new ApiError(
        "AI is not configured. Add your provider API key in Settings.",
        "ai_not_configured",
      ),
    );
    const container = mount(createElement(AskJournal), "es");
    await setValue(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Haz una pregunta a tu diario"]',
      )!,
      "¿Cómo fue mi semana?",
    );
    await click(buttonByText(container, "Preguntar"));
    expect(document.body.textContent).toContain("Configura la IA para continuar");
    expect(document.body.textContent).not.toContain("AI is not configured");
  });

  it("fr: the export dialog title and download link follow the locale", async () => {
    const container = mount(
      createElement(ReviewExport, {
        document: { title: "Revue quotidienne · 2026-09-15", subtitle: "", lines: ["- [x] fait"] },
      }),
      "fr",
    );
    await click(buttonByText(container, "Exporter en PDF")!);
    expect(document.body.textContent).toContain("Export de la revue");
    expect(document.body.textContent).toContain("Télécharger le PDF");
    expect(document.body.textContent).not.toContain("Download PDF");
  });
});
