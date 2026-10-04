// @vitest-environment jsdom
// T32: the AI components read the `ai` namespace, so the trees render inside
// NextIntlClientProvider via renderWithLocale (docs/i18n.md §14).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { computeMetrics, type AnalysisFilters } from "@luxalgo/journal-core";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { loadMessages, renderWithLocale } from "./helpers/i18n";

const state = vi.hoisted(() => ({
  filters: { accounts: "a" } as AnalysisFilters,
  timeZone: "UTC",
  save: vi.fn(),
  post: vi.fn(),
}));
vi.mock("@/components/filter-bar", () => ({
  FilterBar: () => null,
  useFilters: () => ({
    values: state.filters,
    query: new URLSearchParams(state.filters).toString(),
    timeZone: state.timeZone,
  }),
}));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => state.post(...args),
  useApi: () => ({
    data: {
      metrics: { ...computeMetrics([]), closedTrades: 1 },
      trades: [],
      intraday: [],
      note: "Original note",
    },
  }),
}));
vi.mock("@/lib/use-autosave", () => ({
  formatAutosaveStatus: (_c: unknown, _e: unknown, s: { state: string } | undefined, fb: string) =>
    !s || s.state === "idle"
      ? fb
      : s.state === "error"
        ? `Not saved: x`
        : s.state === "saving"
          ? "Saving…"
          : "Saved",
  useAutosave: () => ({
    save: state.save,
    status: "Saved",
    saveState: { state: "saved", message: "", errorInfo: null },
    flush: vi.fn(),
  }),
}));
vi.mock("@/components/rich-editor", () => ({
  RichEditor: ({ value, onChange }: { value: string; onChange: (s: string) => void }) =>
    createElement("textarea", {
      value,
      onChange: () => {},
      onInput: (e: { currentTarget: HTMLTextAreaElement }) => onChange(e.currentTarget.value),
    }),
}));
vi.mock("@/components/charts/equity-area", () => ({ EquityArea: () => null }));
vi.mock("@/components/pnl", () => ({ Pnl: () => null }));
vi.mock("@/components/privacy", () => ({ MonetaryValue: () => null }));
vi.mock("@/components/voice-note", () => ({ VoiceNote: () => null }));
vi.mock("@/components/attachments", () => ({ Attachments: () => null }));
vi.mock("@/components/review-export", () => ({ ReviewExport: () => null }));
const { AskJournal } = await import("../src/components/ask-journal");
const { default: JournalDayPage } = await import("../src/app/journal/[date]/page");

let container: HTMLElement;
let rerender: (ui: ReactElement) => void;
const cleanups: Array<() => void> = [];
beforeEach(() => {
  state.filters = { accounts: "a" };
  state.timeZone = "UTC";
  state.post.mockReset();
  state.save.mockReset();
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = "";
});
const mount = (ui: ReactElement, locale = "en") => {
  // The root layout wraps the app in TooltipProvider (titled buttons use it).
  const rendered = renderWithLocale(
    createElement(TooltipProvider, { delayDuration: 0, children: ui }),
    { locale },
  );
  container = rendered.container;
  rerender = (next: ReactElement) =>
    rendered.rerender(createElement(TooltipProvider, { delayDuration: 0, children: next }));
  cleanups.push(rendered.unmount);
};
const renderAsk = (locale = "en") => mount(createElement(AskJournal), locale);
const refreshAsk = () => act(async () => rerender(createElement(AskJournal)));
const click = (text: string) =>
  act(async () => {
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(text),
    );
    expect(button, text).toBeTruthy();
    button!.click();
  });
const suggestion = "What's my most expensive mistake?";
const reply = (answer: string) => ({
  answer,
  scope: { label: "Account A · UTC", timeZone: "UTC" },
});

it("sends the full current filter snapshot and displays the server-confirmed scope", async () => {
  state.filters = {
    accounts: "a,b",
    from: "2026-09-01",
    to: "2026-09-15",
    symbol: "AAPL",
    reviewed: "yes",
  };
  state.post.mockResolvedValue(reply("Scoped answer"));
  renderAsk();
  await click(suggestion);
  expect(state.post).toHaveBeenCalledWith("/api/ai/ask", {
    question: suggestion,
    filters: state.filters,
    timeZone: "UTC",
  });
  expect(container.textContent).toContain("Scoped answer");
  expect(container.textContent).toContain("Account A · UTC");
  state.filters = {};
  await refreshAsk();
  expect(container.textContent).not.toContain("Scoped answer");
});

it.each(["accounts", "symbol", "timezone"])(
  "discards late answers after changing %s, including returning to A",
  async (change) => {
    const old = deferred(),
      current = deferred();
    state.post.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    renderAsk();
    await click(suggestion);
    if (change === "accounts") state.filters = { accounts: "b" };
    else if (change === "symbol") state.filters = { accounts: "a", symbol: "MSFT" };
    else state.timeZone = "America/New_York";
    await refreshAsk();
    state.filters = { accounts: "a" };
    state.timeZone = "UTC";
    await refreshAsk();
    await click(suggestion);
    await act(async () => old.resolve(reply("OLD RESULT")));
    expect(container.textContent).not.toContain("OLD RESULT");
    expect(container.textContent).toContain("Thinking");
    await act(async () => current.resolve(reply("CURRENT RESULT")));
    expect(container.textContent).toContain("CURRENT RESULT");
  },
);

it("ignores old errors and allows retry after a current failure", async () => {
  const old = deferred();
  state.post
    .mockReturnValueOnce(old.promise)
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValueOnce(reply("Retry answer"));
  renderAsk();
  await click(suggestion);
  state.filters = { accounts: "b" };
  await refreshAsk();
  await act(async () => old.reject(new Error("OLD ERROR")));
  expect(container.querySelector("[data-ai-notice]")).toBeNull();
  await click(suggestion);
  expect(container.textContent).toContain("Couldn’t complete the AI request");
  await click("Try again");
  expect(container.textContent).toContain("Retry answer");
});

it("renders the localized failure and retry path under zh-CN", async () => {
  state.post
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValueOnce(reply("已重试的回答"));
  renderAsk("zh-CN");
  await click("我最昂贵的错误是什么？");
  expect(container.textContent).toContain("无法完成 AI 请求");
  await click("重试");
  expect(container.textContent).toContain("已重试的回答");
});

it("prevents duplicate submissions before a rerender", async () => {
  state.post.mockReturnValue(deferred().promise);
  renderAsk();
  await act(async () => {
    const buttons = container.querySelectorAll("button");
    buttons[1]!.click();
    buttons[2]!.click();
  });
  expect(state.post).toHaveBeenCalledTimes(1);
});

function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const recapReply = {
  recap: "Generated recap",
  scope: { label: "2026-09-15 · Account A · UTC", timeZone: "UTC" },
};
// The day page suspends on `use(params)`, which cannot resume after
// renderWithLocale's synchronous act — so it mounts through an awaited act
// with the same provider shape (locale + real messages from the helper).
let dayRoot: Root;
const dayTree = (date: string, locale: string) =>
  createElement(NextIntlClientProvider, {
    locale,
    messages: loadMessages(locale),
    timeZone: "UTC",
    children: createElement(TooltipProvider, {
      delayDuration: 0,
      children: createElement(JournalDayPage, { params: Promise.resolve({ date }) }),
    }),
  });
const renderDay = async (date: string, locale = "en") => {
  const host = document.body.appendChild(document.createElement("div"));
  dayRoot = createRoot(host);
  container = host;
  cleanups.push(() => {
    act(() => dayRoot.unmount());
    host.remove();
  });
  await act(async () => dayRoot.render(dayTree(date, locale)));
};
const refreshDay = (date: string) => act(async () => dayRoot.render(dayTree(date, "en")));
const unmountDay = () => act(async () => dayRoot.render(null));

it("appends a labeled recap to edits made while generation is pending", async () => {
  const pending = deferred();
  state.post.mockReturnValue(pending.promise);
  await renderDay("2026-09-15");
  await click("AI recap");
  expect(state.post).toHaveBeenCalledWith("/api/ai/recap", {
    date: "2026-09-15",
    filters: { accounts: "a" },
    timeZone: "UTC",
  });
  await act(async () => {
    const editor = container.querySelector("textarea")!;
    editor.value = "My newest edit";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => pending.resolve(recapReply));
  const saved = state.save.mock.calls.at(-1)![0].note;
  expect(saved).toContain("My newest edit");
  expect(saved).not.toContain("Original note");
  expect(saved).toContain("Account A");
  expect(saved).toContain("Generated recap");
});

it.each(["account", "date", "unmount"])(
  "does not append a delayed recap after %s changes",
  async (change) => {
    const pending = deferred();
    state.post.mockReturnValue(pending.promise);
    await renderDay("2026-09-15");
    await click("AI recap");
    if (change === "account") {
      state.filters = { accounts: "b" };
      await refreshDay("2026-09-15");
      state.filters = { accounts: "a" };
      await refreshDay("2026-09-15");
    } else if (change === "date") await refreshDay("2026-09-16");
    else await unmountDay();
    await act(async () => pending.resolve(recapReply));
    expect(state.save).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Generated recap");
  },
);
