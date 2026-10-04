// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLocale } from "./helpers/i18n";
import { installRadixShims } from "./helpers/jsdom";
import { localeLabels, locales } from "../src/i18n/config";

// The switcher reads the app router at mount time; provide the minimal
// surface it uses (docs/i18n.md §2: POST /api/locale then router.refresh()).
const navState = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navState.refresh }),
}));

// Radix DropdownMenu relies on a few browser APIs jsdom does not implement.
beforeAll(installRadixShims);

const { LanguageSwitcher } = await import("../src/components/language-switcher");

const openMenu = async (trigger: HTMLElement) => {
  await act(async () => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      }),
    );
  });
};

const menuItems = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];

/** Radix items commit on the full pointerdown/up + click sequence. */
const chooseItem = async (item: HTMLElement) => {
  await act(async () => {
    item.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
    );
    item.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse" }),
    );
    item.click();
  });
};

/** Regional-indicator pairs (flag emoji) plus a few legacy flag glyphs. */
const FLAG_PATTERN = /[\u{1F1E6}-\u{1F1FF}]|\u{1F3F4}|\u{2691}/u;

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

beforeEach(() => {
  navState.refresh.mockReset();
});

describe("LanguageSwitcher", () => {
  it("exposes an English accessible name and its own label under en", () => {
    const { container, unmount } = renderWithLocale(createElement(LanguageSwitcher), {
      locale: "en",
    });
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.getAttribute("aria-label")).toBe("Change language");
    expect(trigger.textContent).toContain("English");
    unmount();
  });

  it("exposes a Chinese accessible name and its own label under zh-CN", () => {
    const { container, unmount } = renderWithLocale(createElement(LanguageSwitcher), {
      locale: "zh-CN",
    });
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.getAttribute("aria-label")).toBe("切换语言");
    expect(trigger.textContent).toContain("简体中文");
    unmount();
  });

  it("lists every language under its own name in both UI languages, without flags", async () => {
    for (const uiLocale of ["en", "zh-CN"] as const) {
      const { container, unmount } = renderWithLocale(createElement(LanguageSwitcher), {
        locale: uiLocale,
      });
      const trigger = container.querySelector<HTMLButtonElement>("button")!;
      await openMenu(trigger);
      const items = menuItems();
      expect(items).toHaveLength(locales.length);
      const names = items.map((item) => item.textContent);
      for (const locale of locales) {
        expect(names).toContain(localeLabels[locale]);
      }
      expect(FLAG_PATTERN.test(document.body.textContent ?? "")).toBe(false);
      unmount();
      document.body.innerHTML = "";
    }
  });

  it("persists the choice via POST /api/locale and refreshes only after success", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, unmount } = renderWithLocale(createElement(LanguageSwitcher), {
      locale: "en",
    });
    await openMenu(container.querySelector<HTMLButtonElement>("button")!);
    const item = menuItems().find((candidate) => candidate.textContent === "简体中文")!;
    await chooseItem(item);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/locale",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ locale: "zh-CN" }) }),
    );
    expect(navState.refresh).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("keeps the old language and announces an error when the save fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    const { container, unmount } = renderWithLocale(createElement(LanguageSwitcher), {
      locale: "en",
    });
    await openMenu(container.querySelector<HTMLButtonElement>("button")!);
    const item = menuItems().find((candidate) => candidate.textContent === "简体中文")!;
    await chooseItem(item);
    expect(navState.refresh).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Couldn't save your language. Please try again.");
    unmount();
  });

  it("does not call the API when selecting the already-active language", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container, unmount } = renderWithLocale(createElement(LanguageSwitcher), {
      locale: "en",
    });
    await openMenu(container.querySelector<HTMLButtonElement>("button")!);
    const item = menuItems().find((candidate) => candidate.textContent === "English")!;
    expect(item.getAttribute("aria-current")).toBe("true");
    await chooseItem(item);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navState.refresh).not.toHaveBeenCalled();
    unmount();
  });
});
