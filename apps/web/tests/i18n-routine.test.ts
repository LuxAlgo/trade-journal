// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { renderWithLocale } from "./helpers/i18n";
import type { AnalysisFilters } from "@luxalgo/journal-core";

/**
 * T29/T30 representative i18n test (docs/i18n.md §14): in en and zh-CN, the
 * playbook creation flow and the missed-trade logging flow must be operable
 * purely through localized accessible names (button text/aria-label, field
 * labels), against the real seven-locale message catalogs.
 */

const state = vi.hoisted(() => ({
  playbooks: {
    playbooks: [
      {
        id: "pb1",
        name: "Opening range breakout",
        description: "",
        rules: ["Only A+ setups"],
        tradeCount: 3,
      },
    ],
  },
  missed: { trades: [] as unknown[] },
  post: vi.fn(),
}));

vi.mock("@/lib/use-api", () => ({
  useApi: (url: string) => {
    if (url.startsWith("/api/playbooks"))
      return { data: state.playbooks, error: null, loading: false, refresh: () => {} };
    if (url.startsWith("/api/workspace/missed"))
      return { data: state.missed, error: null, loading: false, refresh: () => {} };
    // /api/adherence and any other read: no data keeps AdherenceReport out of the way.
    return { data: null, error: null, loading: false, refresh: () => {} };
  },
  postJson: (...args: unknown[]) => state.post(...args),
}));
vi.mock("@/components/filter-bar", () => ({
  FilterBar: ({ actions }: { actions?: ReactNode }) =>
    createElement("div", { "data-testid": "filter-bar" }, actions),
  useFilters: (): {
    values: AnalysisFilters;
    query: string;
    range: string;
    timeZone: string;
    accounts: null;
    from: null;
    to: null;
  } => ({
    values: {},
    query: "",
    range: "all",
    timeZone: "UTC",
    accounts: null,
    from: null,
    to: null,
  }),
}));
vi.mock("@/components/rich-editor", () => ({
  RichEditor: ({ value, onChange }: { value: string; onChange: (s: string) => void }) =>
    createElement("textarea", {
      value,
      "aria-label": "notes",
      onChange: (e: { currentTarget: HTMLTextAreaElement }) => onChange(e.currentTarget.value),
    }),
  Markdown: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));
vi.mock("@/components/attachments", () => ({ Attachments: () => null }));
vi.mock("@/components/review-export", () => ({ ReviewExport: () => null }));
vi.mock("@/components/privacy", () => ({
  MonetaryValue: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  MonetaryField: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));

const { default: PlaybooksPage } = await import("../src/app/playbooks/page");
const { default: MissedPage } = await import("../src/app/missed/page");
const { TooltipProvider } = await import("../src/components/ui/tooltip");

const flush = () => act(async () => {});
let unmount: (() => void) | null = null;
const render = (ui: ReactElement, locale: string) => {
  const result = renderWithLocale(createElement(TooltipProvider, null, ui), { locale });
  unmount = result.unmount;
};

const buttonByName = (name: string) =>
  Array.from(document.body.querySelectorAll("button")).find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === name,
  );

const inputByLabel = (label: string) =>
  (Array.from(document.body.querySelectorAll("label"))
    .find((l) => (l.textContent ?? "").trim() === label)
    ?.querySelector("input") ?? null) as HTMLInputElement | null;

const inputByPlaceholder = (placeholder: string) =>
  (Array.from(document.body.querySelectorAll("input")).find((i) => i.placeholder === placeholder) ??
    null) as HTMLInputElement | null;

const setInputValue = (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const clickButton = async (name: string) => {
  const button = buttonByName(name);
  expect(button, `button with accessible name "${name}"`).toBeTruthy();
  await act(async () => {
    button!.click();
  });
  await flush();
};

beforeEach(() => {
  state.post.mockReset();
  state.post.mockResolvedValue({});
  state.missed = { trades: [] };
});

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const copy = {
  en: {
    newPlaybook: "New playbook",
    namePlaceholder: "Name (e.g. Opening range breakout)",
    create: "Create",
    deleteAria: "Delete playbook Opening range breakout",
    deleteConfirm: 'Delete "Opening range breakout"?',
    logOpportunity: "Log opportunity",
    dialogTitle: "Log a missed opportunity",
    symbolLabel: "Symbol",
    save: "Save opportunity",
  },
  "zh-CN": {
    newPlaybook: "新建交易剧本",
    namePlaceholder: "名称（例如：开盘区间突破）",
    create: "创建",
    deleteAria: "删除交易剧本 Opening range breakout",
    deleteConfirm: "删除「Opening range breakout」？",
    logOpportunity: "记录错失机会",
    dialogTitle: "记录错失机会",
    symbolLabel: "代码",
    save: "保存机会",
  },
} as const;

for (const [locale, c] of Object.entries(copy)) {
  describe(`routine flows stay operable in ${locale}`, () => {
    it("creates a playbook through localized accessible names", async () => {
      render(createElement(PlaybooksPage), locale);
      await flush();

      await clickButton(c.newPlaybook);
      const nameInput = inputByPlaceholder(c.namePlaceholder);
      expect(nameInput, `name input by placeholder "${c.namePlaceholder}"`).toBeTruthy();
      setInputValue(nameInput!, "Test setup");
      await flush();

      await clickButton(c.create);
      expect(state.post).toHaveBeenCalledTimes(1);
      const [url, body] = state.post.mock.calls[0]!;
      expect(url).toBe("/api/playbooks");
      expect(body).toEqual({ name: "Test setup", description: "", rules: [] });
      // Dialog closed after a successful create.
      expect(inputByPlaceholder(c.namePlaceholder)).toBeNull();
    });

    it("asks a localized delete confirmation carrying the playbook name", async () => {
      render(createElement(PlaybooksPage), locale);
      await flush();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

      const deleteButton = buttonByName(c.deleteAria);
      expect(deleteButton, `delete button aria-label "${c.deleteAria}"`).toBeTruthy();
      await act(async () => {
        deleteButton!.click();
      });
      await flush();

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      const message = confirmSpy.mock.calls[0]![0] as string;
      expect(message.startsWith(c.deleteConfirm)).toBe(true);
      // Cancelled confirm must not send anything.
      expect(state.post).not.toHaveBeenCalled();
    });

    it("logs a missed trade through localized accessible names", async () => {
      render(createElement(MissedPage), locale);
      await flush();

      await clickButton(c.logOpportunity);
      expect(document.body.textContent).toContain(c.dialogTitle);
      const symbolInput = inputByLabel(c.symbolLabel);
      expect(symbolInput, `symbol input labelled "${c.symbolLabel}"`).toBeTruthy();
      setInputValue(symbolInput!, "NQ");
      await flush();

      await clickButton(c.save);
      expect(state.post).toHaveBeenCalledTimes(1);
      const [url, body] = state.post.mock.calls[0]!;
      expect(url).toBe("/api/workspace/missed");
      expect(body).toMatchObject({
        symbol: "NQ",
        direction: "long",
        entry: null,
        stop: null,
        target: null,
        notes: "",
      });
      // Dialog closed after a successful save.
      expect(inputByLabel(c.symbolLabel)).toBeNull();
    });
  });
}
