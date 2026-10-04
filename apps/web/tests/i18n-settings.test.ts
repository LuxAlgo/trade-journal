// @vitest-environment jsdom
// T26/T31 representative i18n test: the Settings tabs, the export wording and
// the import preview diagnostics are verifiable by accessible name/text in a
// second language, while machine outputs (format detection, counts) stay put.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { loadMessages, renderWithLocale } from "./helpers/i18n";
const state = vi.hoisted(() => ({
  post: vi.fn(),
  push: vi.fn(),
  settings: {} as Record<string, unknown>,
  // The real useApi keeps `data` referentially stable between refetches (it
  // lives in useState), and settings components sync drafts from it in
  // `[data]` effects (journal-default-settings, journal-settings, ai-settings,
  // currency-settings). Returning a fresh object literal per mocked call would
  // re-trigger those effects forever — an unbounded microtask render loop that
  // starves timers and hangs the whole suite — so every mocked endpoint hands
  // out one hoisted, stable object instead.
  workspaceDefaults: { breakeven: 0, breakevenMode: "money", feeRules: [], riskRules: [] },
  accounts: { accounts: [{ id: "a1", name: "Main", currency: "USD" }] },
  connections: {
    connections: [
      { id: "alpaca", name: "Alpaca", configured: false, source: null },
      { id: "binance", name: "Binance", configured: false, source: null },
    ],
  },
  csv: { datasets: [] },
  brokers: { brokers: [] },
  formats: { formats: [] },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/components/filter-bar", () => ({ FilterBar: () => null }));
vi.mock("@/components/manual-trade-entry", () => ({ ManualTradeEntry: () => null }));
vi.mock("@/components/timezone-picker", () => ({ TimeZonePicker: () => null }));
vi.mock("@/components/account-picker", () => ({
  AccountPicker: ({ onChange }: { onChange: (id: string) => void }) =>
    createElement("button", { onClick: () => onChange("test-account") }, "Choose test account"),
}));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => state.post(...args),
  useApi: (url: string) => ({
    data:
      url === "/api/settings"
        ? state.settings
        : url === "/api/workspace/defaults"
          ? state.workspaceDefaults
          : url === "/api/accounts"
            ? state.accounts
            : url === "/api/market-data/connections"
              ? state.connections
              : url === "/api/market-data/csv"
                ? state.csv
                : url === "/api/brokers"
                  ? state.brokers
                  : state.formats,
  }),
}));
const { default: SettingsPage } = await import("../src/app/settings/page");
const { default: ImportPage } = await import("../src/app/import/page");
let unmounts: (() => void)[] = [];
beforeEach(() => {
  state.post.mockReset();
  state.push.mockReset();
  state.settings = {
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
  vi.spyOn(window, "alert").mockImplementation(() => {});
});
afterEach(() => {
  for (const unmount of unmounts) unmount();
  unmounts = [];
  vi.restoreAllMocks();
});
const renderPage = (page: typeof SettingsPage | typeof ImportPage, locale: string) => {
  const rendered = renderWithLocale(createElement(TooltipProvider, null, createElement(page)), {
    locale,
  });
  unmounts.push(rendered.unmount);
  return rendered.container;
};
it("exposes the Settings sections and the accurate export wording by accessible text in English", () => {
  const container = renderPage(SettingsPage, "en");
  const nav = container.querySelector("nav")!;
  expect(nav.getAttribute("aria-label")).toBe("Settings sections");
  for (const label of [
    "General",
    "Trading",
    "Currency conversion",
    "Market data",
    "AI",
    "Data & backups",
  ])
    expect(nav.textContent).toContain(label);
  // Language picker lives in General and is reachable by its accessible name.
  expect(container.querySelector('button[aria-label="Change language"]')).not.toBeNull();
  // JSON export is a data export, never advertised as a restorable backup.
  expect(container.textContent).toContain("Export data (JSON)");
  expect(container.textContent).toContain("not a directly restorable full backup");
  expect(container.textContent).toContain("copying the data directory");
  expect(container.textContent).not.toContain("Full backup (JSON)");
});
it("renders the same sections and wording in Simplified Chinese", () => {
  expect(loadMessages("zh-CN")).toBeTruthy();
  const container = renderPage(SettingsPage, "zh-CN");
  const nav = container.querySelector("nav")!;
  expect(nav.textContent).toContain("通用");
  expect(nav.textContent).toContain("数据与备份");
  expect(container.querySelector('button[aria-label="切换语言"]')).not.toBeNull();
  expect(container.textContent).toContain("导出数据（JSON）");
  expect(container.textContent).toContain("不是可直接恢复的完整备份");
  expect(container.textContent).toContain("复制数据目录");
});
it("localizes import preview diagnostics by code while keeping counts identical in Chinese", async () => {
  const container = renderPage(ImportPage, "zh-CN");
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
  // Choosing a file (AI off) runs the preview immediately; the resolved body
  // here is undefined, so the explicit "Preview file" re-runs below.
  expect(state.post).toHaveBeenCalledTimes(1);
  state.post.mockResolvedValueOnce({
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
  });
  await act(async () => {
    const preview = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "预览文件",
    );
    preview!.click();
  });
  // The warning shows through its diagnostic code, not the English original.
  expect(container.textContent).toContain("该导出按整笔交易记录，开仓与平仓成交由报告价格重建。");
  expect(container.textContent).not.toContain("TradeZella exports are trade-level");
  // Counts and machine fields are locale-independent.
  expect(container.textContent).toContain("1 条执行记录");
  expect(container.textContent).toContain("2 行已跳过");
  expect(container.textContent).toContain("tradezella");
  expect(container.textContent).toContain("TEST · BUY");
});
