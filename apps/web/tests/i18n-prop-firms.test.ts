// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLocale } from "./helpers/i18n";
import { installRadixShims } from "./helpers/jsdom";
import { PRIVACY_KEY } from "../src/lib/privacy-preference";
import type { PropData } from "../src/lib/prop-firms";

// FilterBar reads the app router; provide the minimal surface it uses.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/prop-firms",
  useSearchParams: () => new URLSearchParams(),
}));

// Radix Select/Dialog rely on a few browser APIs jsdom does not implement.
beforeAll(installRadixShims);

// Single-currency saved data so summary totals render real numbers in every
// language and the digit signature can be compared across locales.
const saved: PropData = {
  today: "2026-09-07",
  accounts: [
    {
      id: "acc-1",
      firm: "Fixture Firm",
      name: "Eval One",
      program: "evaluation",
      status: "active",
      currency: "USD",
      sizeMinor: 5_000_000,
      parentId: null,
      journalAccountId: null,
      openedOn: "2026-08-01",
      closedOn: null,
      renewalOn: null,
      renewalMinor: null,
      notes: "",
      archived: false,
      revision: 1,
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    },
  ],
  entries: [
    {
      id: "ent-1",
      accountId: "acc-1",
      firm: "Fixture Firm",
      kind: "expense",
      category: "evaluation",
      currency: "USD",
      amountMinor: 50_000,
      splitBps: 10_000,
      feeMinor: 0,
      occurredOn: "2026-08-02",
      dueOn: null,
      status: "completed",
      parentId: null,
      reference: "INV-1",
      notes: "",
      voided: false,
      revision: 1,
      createdAt: "2026-08-02T00:00:00Z",
      updatedAt: "2026-08-02T00:00:00Z",
    },
    {
      id: "ent-2",
      accountId: "acc-1",
      firm: "Fixture Firm",
      kind: "payout",
      category: "payout",
      currency: "USD",
      amountMinor: 900_000,
      splitBps: 8_000,
      feeMinor: 5_000,
      occurredOn: "2026-09-01",
      dueOn: null,
      status: "requested",
      parentId: null,
      reference: "",
      notes: "",
      voided: false,
      revision: 1,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ],
  receipts: [
    {
      id: "rec-1",
      payoutId: "ent-2",
      kind: "receipt",
      amountMinor: 300_000,
      occurredOn: "2026-09-02",
      reference: "",
      notes: "",
      voided: false,
      createdAt: "2026-09-02T00:00:00Z",
    },
  ],
};

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PRIVACY_KEY, "false");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/settings")) return jsonResponse({ timeZone: "UTC" });
      if (url.includes("/api/prop-firms")) return jsonResponse(saved);
      if (url.includes("/api/accounts")) return jsonResponse({ accounts: [] });
      return jsonResponse({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const { PropFirmTracker } = await import("../src/components/prop-firm-tracker");
const { PrivacyProvider } = await import("../src/components/privacy");

const buttons = () => [...document.querySelectorAll("button")];
const buttonByName = (name: string) =>
  buttons().find((b) => (b.getAttribute("aria-label") ?? b.textContent)?.trim() === name);
const tabs = () => [...document.querySelectorAll("[role='tab']")];
const tabByName = (name: string) => tabs().find((tab) => tab.textContent?.trim() === name);
const dialog = () => document.querySelector("[role='dialog']");
const options = () => [...document.querySelectorAll("[role='option']")];
const checkboxByName = (name: string) => {
  const field = [...document.querySelectorAll("label")].find(
    (l) => l.querySelector("input[type='checkbox']") && l.textContent?.includes(name),
  );
  return field?.querySelector<HTMLInputElement>("input[type='checkbox']");
};

/** Field control (input / combobox trigger) sitting inside the Field labeled `text`. */
const fieldControl = (text: string) => {
  const field = [...document.querySelectorAll("label")].find(
    (l) => l.querySelector("span")?.textContent?.trim() === text,
  );
  return field?.querySelector<HTMLElement>("input, textarea, button");
};

const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

/** Render and flush the useApi fetch chain until `found` appears. */
const renderTracker = async (locale: string, found: () => boolean) => {
  const utils = renderWithLocale(
    createElement(PrivacyProvider, null, createElement(PropFirmTracker)),
    { locale },
  );
  for (let i = 0; i < 20 && !found(); i++) await act(async () => {});
  return utils;
};

const openComboboxAndPick = async (labelText: string, optionText: string) => {
  const trigger = fieldControl(labelText);
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {});
  const option = options().find((o) => o.textContent?.trim() === optionText);
  expect(option).toBeTruthy();
  await act(async () => {
    option!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {});
};

describe("prop-firms page i18n (T25)", () => {
  it("creates an evaluation account through accessible names under en", async () => {
    await renderTracker("en", () =>
      Boolean(buttonByName("Track account") && !buttonByName("Track account")!.disabled),
    );
    expect(buttonByName("Track account")!.disabled).toBe(false);

    await click(buttonByName("Track account")!);
    expect(dialog()).toBeTruthy();
    expect(fieldControl("Firm name")).toBeTruthy();
    expect(fieldControl("Account / attempt name")).toBeTruthy();
    expect(fieldControl("Currency code")).toBeTruthy();

    await openComboboxAndPick("Status", "Passed");
    expect(fieldControl("Status")!.textContent).toContain("Passed");

    // Tabs switch by accessible name and expose their selected state; the
    // accounts view offers the archived-status filter, operable by label.
    await click(tabByName("Accounts")!);
    expect(tabByName("Accounts")!.getAttribute("aria-selected")).toBe("true");
    const archived = checkboxByName("Show archived accounts");
    expect(archived).toBeTruthy();
    await click(archived!);
    expect(archived!.checked).toBe(true);
  });

  it("creates an evaluation account through accessible names under zh-CN", async () => {
    await renderTracker("zh-CN", () =>
      Boolean(buttonByName("登记账户") && !buttonByName("登记账户")!.disabled),
    );
    expect(buttonByName("登记账户")!.disabled).toBe(false);

    await click(buttonByName("登记账户")!);
    expect(dialog()).toBeTruthy();
    expect(fieldControl("公司名称")).toBeTruthy();
    expect(fieldControl("账户 / 尝试名称")).toBeTruthy();

    await openComboboxAndPick("状态", "已通过");
    expect(fieldControl("状态")!.textContent).toContain("已通过");

    await click(tabByName("账户")!);
    expect(tabByName("账户")!.getAttribute("aria-selected")).toBe("true");
    const archived = checkboxByName("显示已归档账户");
    expect(archived).toBeTruthy();
    await click(archived!);
    expect(archived!.checked).toBe(true);
  });

  it("keeps the same cash total value across all seven locales", async () => {
    const signatures: string[] = [];
    for (const locale of ["en", "zh-CN", "ja", "ko", "zh-TW", "es", "fr"]) {
      document.body.innerHTML = "";
      await renderTracker(locale, () =>
        [...document.querySelectorAll(".tabular-nums")].some((el) =>
          /\d/.test(el.textContent ?? ""),
        ),
      );
      // First tabular amount holding text is the summary's money spent.
      const spent = [...document.querySelectorAll(".tabular-nums")]
        .map((el) => el.textContent ?? "")
        .find((text) => /\d/.test(text));
      expect(spent).toBeDefined();
      expect(spent!).toMatch(/\d/);
      // Separators differ by locale (docs/i18n.md §8); the digits must not.
      signatures.push(spent!.replace(/\D/g, ""));
    }
    expect(new Set(signatures).size).toBe(1);
    expect(signatures[0]).toBe("50000"); // 50,000 minor units = $500.00
  });
});
