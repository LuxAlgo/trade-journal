// @vitest-environment jsdom
// Representative i18n coverage for the dashboard page group (T20): the stat
// cards, the calendar month title and the add-trade dialog must be operable
// purely through localized accessible names under "en" and "zh-CN", against
// the real seven-locale message catalogs (docs/i18n.md §14).
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLocale } from "./helpers/i18n";
import { installRadixShims } from "./helpers/jsdom";
import { PRIVACY_KEY } from "../src/lib/privacy-preference";

const state = vi.hoisted(() => ({
  stats: null as unknown,
  post: vi.fn(),
}));

vi.mock("@/lib/use-api", () => ({
  useApi: (url: string) =>
    url.startsWith("/api/stats")
      ? { data: state.stats, error: null, loading: false, refresh: () => {} }
      : { data: null, error: null, loading: false, refresh: () => {} },
  postJson: (...args: unknown[]) => state.post(...args),
}));
vi.mock("@/components/filter-bar", () => ({
  FilterBar: ({ actions }: { actions?: ReactNode }) =>
    createElement("div", { "data-testid": "filter-bar" }, actions),
  useFilters: () => ({
    values: {},
    query: "",
    range: "all",
    timeZone: "UTC",
    accounts: null,
    from: null,
    to: null,
  }),
}));
// Chart internals (axes/legends/tooltips) belong to the charts worker; the
// dashboard test only asserts card-level labels, so stub the visuals out.
vi.mock("@/components/charts/daily-bars", () => ({ DailyBars: () => null }));
vi.mock("@/components/charts/edge-radar", () => ({ EdgeRadar: () => null }));
vi.mock("@/components/charts/equity-area", () => ({ EquityArea: () => null }));
vi.mock("@/components/charts/gauge", () => ({
  Gauge: ({ label }: { label: string }) =>
    createElement("div", { role: "img", "aria-label": label }),
}));
vi.mock("@/components/charts/relative-drawdown-bars", () => ({
  RelativeDrawdownBars: () => null,
}));
vi.mock("@/components/charts/time-heatmap", () => ({ TimeHeatmap: () => null }));
vi.mock("@/components/calendar-pnl", () => ({ CalendarPnl: () => null }));
// Account picker as a native select (same stand-in approach as i18n-accounts).
vi.mock("@/components/account-picker", () => ({
  AccountPicker: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (id: string) => void;
    kind?: string;
  }) =>
    createElement(
      "select",
      {
        "aria-label": "account-picker",
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      },
      createElement("option", { value: "acc-1" }, "Test account"),
    ),
}));
// Radix Select as a native select (side picker in each execution row).
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
// Radix Dialog passthrough: the add-trade form renders without portals.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogContent: ({ children }: { children: ReactNode }) => children,
  DialogHeader: ({ children }: { children: ReactNode }) => children,
  DialogTitle: ({ children }: { children: ReactNode }) => children,
  DialogDescription: ({ children }: { children: ReactNode }) => children,
  DialogTrigger: ({ children }: { children: ReactNode }) => children,
}));

beforeAll(() => {
  const globals = globalThis as Record<string, unknown>;
  const mediaQuery = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
  // useReducedDashboardMotion reads window.matchMedia; jsdom does not ship it.
  (window as unknown as Record<string, unknown>).matchMedia ??= mediaQuery;
  globals.matchMedia ??= mediaQuery;
  installRadixShims();
});

const metrics = {
  totalTrades: 3,
  closedTrades: 3,
  openTrades: 0,
  wins: 2,
  losses: 1,
  breakevens: 0,
  netPnl: 170,
  grossPnl: 180,
  fees: 10,
  winRate: 2 / 3,
  dayWinRate: 0.5,
  tradingDays: 2,
  profitFactor: 3.6,
  profitFactorIsInfinite: false,
  avgWin: 125,
  avgLoss: -80,
  avgWinLossRatio: 1.56,
  expectancy: 56.7,
  largestWin: 150,
  largestLoss: -80,
  maxWinStreak: 2,
  maxLossStreak: 1,
  currentStreak: 1,
  totalVolume: 30,
  avgDurationMs: 3_600_000,
  maxDrawdown: 80,
  maxDrawdownPct: 0.008,
  recoveryFactor: 2.1,
  profitConcentration: null,
  avgRealizedR: 1.4,
  tradesWithRisk: 2,
};

const statsPayload = {
  timeZone: "UTC",
  metrics,
  currencyScope: {
    currency: "USD",
    sourceCurrencies: [],
    converted: false,
    monetary: true,
    missingCurrencies: [],
  },
  currencyGroups: [],
  initialBalance: 10_000,
  edgeScore: {
    version: 1,
    score: 72,
    components: {
      winRate: 60,
      profitFactor: 80,
      avgWinLoss: 55,
      drawdown: 70,
      recovery: 66,
      consistency: 50,
    },
    closedTrades: 3,
  },
  days: [
    {
      date: "2026-10-01",
      netPnl: 250,
      grossPnl: 260,
      fees: 10,
      trades: 2,
      wins: 2,
      losses: 0,
      breakevens: 0,
      volume: 20,
    },
    {
      date: "2026-10-02",
      netPnl: -80,
      grossPnl: -70,
      fees: 10,
      trades: 1,
      wins: 0,
      losses: 1,
      breakevens: 0,
      volume: 10,
    },
  ],
  dailyCumulative: [
    { t: "2026-10-01T20:00:00Z", cumNetPnl: 250 },
    { t: "2026-10-02T20:00:00Z", cumNetPnl: 170 },
  ],
  calendar: {
    year: 2026,
    month: 10,
    weeks: [],
    monthNetPnl: 170,
    monthTrades: 3,
    tradingDays: 2,
    winningDays: 1,
  },
  calendarCurrencies: ["USD"],
  runningPnl: {},
  buckets: { symbol: [], weekday: [], hour: [], duration: [], direction: [] },
  openPositions: [],
  recentTrades: [
    {
      key: "20261002-AAPL",
      symbol: "AAPL",
      closedAt: "2026-10-02T20:00:00Z",
      netPnl: 150,
      currency: "USD",
      status: "win",
    },
  ],
};

const emptyPayload = {
  ...statsPayload,
  metrics: { ...metrics, totalTrades: 0, closedTrades: 0 },
  days: [],
  recentTrades: [],
};

const copy = {
  en: {
    addTrade: "Add trade",
    netPnl: "Net P&L",
    tradeWin: "Trade win %",
    edgeScore: "Edge Score",
    maxDrawdown: "Max drawdown",
    gaugeLabel: "Trade win rate",
    monthTitle: "October 2026",
    winBadge: "Win",
    customize: "Customize",
    findCard: "Find dashboard cards",
    cardHeading: "Dashboard cards",
    layoutsAria: "Dashboard layouts",
    saveTrade: "Save trade",
    symbol: "Symbol",
    quantity: "Quantity",
    price: "Price",
    dateTime: "Date & time",
    loadDemo: "Load demo data",
    emptyTitle: "Your journal is empty",
  },
  "zh-CN": {
    addTrade: "添加交易",
    netPnl: "净盈亏",
    tradeWin: "交易胜率",
    edgeScore: "优势评分",
    maxDrawdown: "最大回撤",
    gaugeLabel: "交易胜率",
    monthTitle: "2026年10月",
    winBadge: "盈利",
    customize: "自定义",
    findCard: "查找仪表盘卡片",
    cardHeading: "仪表盘卡片",
    layoutsAria: "仪表盘布局",
    saveTrade: "保存交易",
    symbol: "交易代码",
    quantity: "数量",
    price: "价格",
    dateTime: "日期和时间",
    loadDemo: "加载演示数据",
    emptyTitle: "你的交易日志还是空的",
  },
} as const;

type UiLocale = "en" | "zh-CN";

const cleanups: Array<() => void> = [];
const mount = (ui: ReactElement, locale: UiLocale) => {
  const rendered = renderWithLocale(ui, { locale });
  cleanups.push(rendered.unmount);
  return rendered;
};

const setValue = async (input: HTMLInputElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    const proto =
      input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};
const buttonByText = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === text)!;
const labeledInput = (container: HTMLElement, text: string) => {
  const label = [...container.querySelectorAll("label")].find((candidate) =>
    candidate.textContent?.trim().startsWith(text),
  );
  if (!label) return null;
  return label.getAttribute("for")
    ? (document.getElementById(label.getAttribute("for")!) as HTMLInputElement)
    : (label.querySelector("input") as HTMLInputElement);
};

const { default: DashboardPage } = await import("../src/app/page");
const { TooltipProvider } = await import("../src/components/ui/tooltip");
const { PrivacyProvider } = await import("../src/components/privacy");

const renderDashboard = (locale: UiLocale, stats: unknown) => {
  state.stats = stats;
  return mount(
    createElement(TooltipProvider, {
      delayDuration: 0,
      children: createElement(PrivacyProvider, { children: createElement(DashboardPage) }),
    }),
    locale,
  );
};

beforeEach(() => {
  state.post.mockReset().mockResolvedValue({});
  localStorage.setItem(PRIVACY_KEY, "false");
  localStorage.removeItem("journal-dashboard-layouts-v1");
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Dashboard i18n (T20)", () => {
  it.each(["en", "zh-CN"] as UiLocale[])(
    "renders the stat cards by localized accessible name under %s",
    async (locale) => {
      const expected = copy[locale];
      const { container } = renderDashboard(locale, statsPayload);

      for (const card of [
        expected.netPnl,
        expected.tradeWin,
        expected.edgeScore,
        expected.maxDrawdown,
      ])
        expect(container.querySelector(`section[aria-label="${card}"]`)).not.toBeNull();
      // Card explainer icon + gauge label are localized too.
      expect(
        container.querySelector(`[role="img"][aria-label="${expected.gaugeLabel}"]`),
      ).not.toBeNull();
      // Calendar month title follows the interface locale.
      expect(container.textContent).toContain(expected.monthTitle);
      // Recent-trade status badge comes from the shared enums namespace.
      expect(container.textContent).toContain(expected.winBadge);
      // Layout controls keep their localized accessible names.
      expect(
        container.querySelector(`button[aria-label="${expected.layoutsAria}"]`),
      ).not.toBeNull();
    },
  );

  it.each(["en", "zh-CN"] as UiLocale[])(
    "resolves the rich-text money notes on the summary cards under %s",
    async (locale) => {
      // Regression guard: the dashboard messages used {fees}/{win}/{loss}
      // plain args with t.rich tag handlers, so React logged "Functions are
      // not valid as a React child" and the fees/avg-win/avg-loss values
      // vanished. The messages now wrap the values in <fees>/<win>/<loss>
      // tags; this asserts the real rendered output (the i18n-rich-tags
      // gate covers the static message side for every rich call site).
      const expected =
        locale === "en"
          ? {
              fees: "3 closed trades · +$10.00 fees",
              avgWinLoss: "+$125.00 avg win · +$80.00 avg loss",
            }
          : {
              fees: "3 笔已平仓交易 · 手续费 +US$10.00",
              avgWinLoss: "+US$125.00 平均盈利 · +US$80.00 平均亏损",
            };
      const { container } = renderDashboard(locale, statsPayload);
      expect(container.textContent).toContain(expected.fees);
      expect(container.textContent).toContain(expected.avgWinLoss);
      expect(container.textContent).not.toContain("<fees>");
      expect(container.textContent).not.toContain("<win>");
    },
  );

  it.each(["en", "zh-CN"] as UiLocale[])(
    "saves a manual trade through the localized dialog under %s",
    async (locale) => {
      const expected = copy[locale];
      const { container } = renderDashboard(locale, statsPayload);

      await click(buttonByText(container, expected.addTrade));
      await setValue(
        container.querySelector<HTMLSelectElement>('select[aria-label="account-picker"]')!,
        "acc-1",
      );
      await setValue(labeledInput(container, expected.symbol)!, "aapl");
      await setValue(labeledInput(container, expected.dateTime)!, "2026-10-01T14:30");
      await setValue(labeledInput(container, expected.quantity)!, "1");
      await setValue(labeledInput(container, expected.price)!, "100");

      await click(buttonByText(container, expected.saveTrade));
      expect(state.post).toHaveBeenCalledTimes(1);
      const [url, body] = state.post.mock.calls[0] as [string, Record<string, unknown>];
      expect(url).toBe("/api/executions");
      expect(body.accountId).toBe("acc-1");
      expect(body.executions).toEqual([
        {
          symbol: "AAPL",
          side: "buy",
          quantity: 1,
          price: 100,
          fee: 0,
          executedAt: new Date("2026-10-01T14:30").toISOString(),
        },
      ]);
    },
  );

  it("offers the localized card customizer by accessible name (en)", async () => {
    const { container } = renderDashboard("en", statsPayload);
    await click(buttonByText(container, copy.en.customize));
    const search = document.body.querySelector<HTMLInputElement>(
      `input[aria-label="${copy.en.findCard}"]`,
    );
    expect(search).not.toBeNull();
    expect(document.body.textContent).toContain(copy.en.cardHeading);
  });

  it.each(["en", "zh-CN"] as UiLocale[])(
    "keeps the demo-data entry point localized under %s",
    async (locale) => {
      const expected = copy[locale];
      state.post.mockRejectedValue(new Error("demo unavailable"));
      const { container } = renderDashboard(locale, emptyPayload);

      expect(container.textContent).toContain(expected.emptyTitle);
      await click(buttonByText(container, expected.loadDemo));
      expect(state.post).toHaveBeenCalledWith("/api/demo", {});
    },
  );
});
