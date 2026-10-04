// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { renderWithLocale } from "./helpers/i18n";
import { calendarMonthFromDays, type DayStats } from "@luxalgo/journal-core";
import { calendarInsights, type CalendarResponse } from "../src/lib/calendar-insights";

/**
 * T21 representative i18n test (docs/i18n.md §14): in en and zh-CN the
 * calendar month navigation is operable through localized accessible names,
 * the per-day "{n} trades" text uses ICU plurals, and the empty insights
 * state is fully localized — against the real seven-locale message catalogs.
 */

const state = vi.hoisted(() => ({ data: null as unknown }));

vi.mock("@/lib/use-api", () => ({
  useApi: () => ({ data: state.data, error: null, loading: false, refresh: () => {} }),
  postJson: async () => ({}),
}));
vi.mock("@/components/filter-bar", () => ({
  FilterBar: ({ actions }: { actions?: ReactNode }) =>
    createElement("div", { "data-testid": "filter-bar" }, actions),
  useFilters: (): {
    values: Record<string, never>;
    query: string;
    range: string;
    timeZone: string;
  } => ({ values: {}, query: "", range: "all", timeZone: "UTC" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/privacy", () => ({
  MonetaryValue: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  usePrivacy: () => false,
}));

const { default: CalendarPage } = await import("../src/app/calendar/page");
const { CalendarPnl } = await import("../src/components/calendar-pnl");
const { CalendarPerformance } = await import("../src/components/calendar-insights");
const { TooltipProvider } = await import("../src/components/ui/tooltip");

const day = (date: string, netPnl: number, trades = 2): DayStats => ({
  date,
  netPnl,
  grossPnl: netPnl + 1,
  fees: 1,
  trades,
  wins: netPnl > 0 ? Math.min(1, trades) : 0,
  losses: netPnl < 0 ? trades : 0,
  breakevens: netPnl === 0 ? trades : 0,
  volume: 10,
});

const month = calendarMonthFromDays(
  [day("2026-09-04", 120), day("2026-09-05", -60), day("2026-09-07", 30, 1)],
  2026,
  9,
);

const response = (calendar: typeof month): CalendarResponse => ({
  calendar,
  insights: calendarInsights(calendar),
  timeZone: "UTC",
  currencies: ["USD"],
  runningPnl: {},
  scope: { from: "2026-09-01", to: "2026-09-30" },
});

let unmount: (() => void) | null = null;
const render = (ui: ReactElement, locale: string) => {
  const result = renderWithLocale(createElement(TooltipProvider, null, ui), { locale });
  unmount = result.unmount;
};

const buttonByAria = (name: string) =>
  Array.from(document.body.querySelectorAll("button")).find(
    (b) => (b.getAttribute("aria-label") ?? "").trim() === name,
  );

beforeEach(() => {
  state.data = null;
});

afterEach(() => {
  unmount?.();
  unmount = null;
});

describe("calendar i18n (en / zh-CN)", () => {
  it("navigates months through localized aria names and renders a localized month label", async () => {
    state.data = response(month);
    render(createElement(CalendarPage), "en");
    expect(document.body.textContent).toContain("September 2026");
    const next = buttonByAria("Next month");
    const previous = buttonByAria("Previous month");
    expect(next).toBeTruthy();
    expect(previous).toBeTruthy();
    await act(async () => {
      next!.click();
    });
    await act(async () => {});
    expect(document.body.textContent).toContain("October 2026");

    unmount?.();
    render(createElement(CalendarPage), "zh-CN");
    expect(document.body.textContent).toContain("2026年9月");
    const zhNext = buttonByAria("下个月");
    const zhPrevious = buttonByAria("上个月");
    expect(zhNext).toBeTruthy();
    expect(zhPrevious).toBeTruthy();
    await act(async () => {
      zhNext!.click();
    });
    await act(async () => {});
    expect(document.body.textContent).toContain("2026年10月");
  });

  it("pluralizes the per-day trade counts with ICU, not string concatenation", () => {
    render(createElement(CalendarPnl, { calendar: month, currency: "USD" }), "en");
    expect(document.body.textContent).toContain("2 trades");
    expect(document.body.textContent).toContain("1 trade");
    expect(document.body.textContent).not.toContain("1 trades");

    unmount?.();
    render(createElement(CalendarPnl, { calendar: month, currency: "USD" }), "zh-CN");
    expect(document.body.textContent).toContain("2 笔交易");
    expect(document.body.textContent).toContain("1 笔交易");
  });

  it("localizes the empty insights state", () => {
    render(
      createElement(CalendarPerformance, {
        data: response(calendarMonthFromDays([], 2026, 9)),
        query: "",
      }),
      "en",
    );
    expect(document.body.textContent).toContain("No closed trades in this view");

    unmount?.();
    render(
      createElement(CalendarPerformance, {
        data: response(calendarMonthFromDays([], 2026, 9)),
        query: "",
      }),
      "zh-CN",
    );
    expect(document.body.textContent).toContain("此视图没有已平仓交易");
  });
});
