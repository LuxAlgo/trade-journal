// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { computeMetrics, type AnalysisFilters } from "@luxalgo/journal-core";
import { TooltipProvider } from "../src/components/ui/tooltip";

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
  useAutosave: () => ({ save: state.save, status: "Saved", flush: vi.fn() }),
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

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.filters = { accounts: "a" };
  state.timeZone = "UTC";
  state.post.mockReset();
  state.save.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const deferred = () => {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const renderAsk = () =>
  act(async () => root.render(createElement(TooltipProvider, null, createElement(AskJournal))));
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
  await renderAsk();
  await click(suggestion);
  expect(state.post).toHaveBeenCalledWith("/api/ai/ask", {
    question: suggestion,
    filters: state.filters,
    timeZone: "UTC",
  });
  expect(container.textContent).toContain("Scoped answer");
  expect(container.textContent).toContain("Account A · UTC");
  state.filters = {};
  await renderAsk();
  expect(container.textContent).not.toContain("Scoped answer");
});

it.each(["accounts", "symbol", "timezone"])(
  "discards late answers after changing %s, including returning to A",
  async (change) => {
    const old = deferred(),
      current = deferred();
    state.post.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await renderAsk();
    await click(suggestion);
    if (change === "accounts") state.filters = { accounts: "b" };
    else if (change === "symbol") state.filters = { accounts: "a", symbol: "MSFT" };
    else state.timeZone = "America/New_York";
    await renderAsk();
    state.filters = { accounts: "a" };
    state.timeZone = "UTC";
    await renderAsk();
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
  await renderAsk();
  await click(suggestion);
  state.filters = { accounts: "b" };
  await renderAsk();
  await act(async () => old.reject(new Error("OLD ERROR")));
  expect(container.querySelector("[data-ai-notice]")).toBeNull();
  await click(suggestion);
  expect(container.textContent).toContain("Couldn’t complete the AI request");
  await click("Try again");
  expect(container.textContent).toContain("Retry answer");
});

it("prevents duplicate submissions before a rerender", async () => {
  state.post.mockReturnValue(deferred().promise);
  await renderAsk();
  await act(async () => {
    const buttons = container.querySelectorAll("button");
    buttons[1]!.click();
    buttons[2]!.click();
  });
  expect(state.post).toHaveBeenCalledTimes(1);
});

const dateParams = Promise.resolve({ date: "2026-09-15" });
const renderDay = (params = dateParams) =>
  act(async () => root.render(createElement(JournalDayPage, { params })));
const recapReply = {
  recap: "Generated recap",
  scope: { label: "2026-09-15 · Account A · UTC", timeZone: "UTC" },
};

it("appends a labeled recap to edits made while generation is pending", async () => {
  const pending = deferred();
  state.post.mockReturnValue(pending.promise);
  await renderDay();
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
    await renderDay();
    await click("AI recap");
    if (change === "account") {
      state.filters = { accounts: "b" };
      await renderDay();
      state.filters = { accounts: "a" };
      await renderDay();
    } else if (change === "date") await renderDay(Promise.resolve({ date: "2026-09-16" }));
    else await act(async () => root.render(null));
    await act(async () => pending.resolve(recapReply));
    expect(state.save).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Generated recap");
  },
);
