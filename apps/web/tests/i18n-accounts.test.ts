// @vitest-environment jsdom
// Representative i18n coverage for the accounts/login page group (T19):
// delete confirmation, create form, profit-calculation edit and the
// wrong-password message must work by accessible name under both "en" and
// "zh-CN". The language switcher lives only in Settings → General since the
// 2026-10-04 product decision (docs/i18n.md §1); the login page has no entry.
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithLocale } from "./helpers/i18n";
import { installRadixShims } from "./helpers/jsdom";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { ApiError } from "../src/lib/api-error";

const state = vi.hoisted(() => ({
  post: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  accounts: [] as unknown,
  accountsError: null as string | null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, refresh: state.refresh }),
}));
vi.mock("@/components/filter-bar", () => ({ FilterBar: () => null }));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => state.post(...args),
  useApi: (url: string) =>
    url.startsWith("/api/accounts")
      ? {
          data: { accounts: state.accounts },
          error: state.accountsError,
          loading: false,
          refresh: vi.fn(),
        }
      : { data: null, error: null, loading: false, refresh: vi.fn() },
}));
// Radix Select as a native select (same stand-in as broker-connect.test.ts).
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
// Radix Dialog passthrough: the create form renders without portals.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogContent: ({ children }: { children: ReactNode }) => children,
  DialogHeader: ({ children }: { children: ReactNode }) => children,
  DialogTitle: ({ children }: { children: ReactNode }) => children,
  DialogDescription: ({ children }: { children: ReactNode }) => children,
}));

// Radix DropdownMenu (language switcher) needs APIs jsdom does not implement.
beforeAll(installRadixShims);

const { default: AccountsPage } = await import("../src/app/accounts/page");
const { default: LoginPage } = await import("../src/app/login/page");

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

const copy = {
  en: {
    deleteTitle: "Delete account",
    deleteConfirm: 'Delete "Main" and ALL its trades? This cannot be undone.',
    newAccount: "New account",
    createButton: "Create account",
    nameLabel: "Account name",
    unlock: "Unlock",
    wrongPassword: "Wrong password. Try again.",
    snapshotSummary: "2 open positions · synced 2026-10-04 12:30",
  },
  "zh-CN": {
    deleteTitle: "删除账户",
    deleteConfirm: "删除「Main」及其全部交易？此操作无法撤销。",
    newAccount: "新建账户",
    createButton: "创建账户",
    nameLabel: "账户名称",
    unlock: "解锁",
    wrongPassword: "密码错误，请重试。",
    snapshotSummary: "2 个持仓 · 同步于 2026-10-04 12:30",
  },
} as const;

type UiLocale = "en" | "zh-CN";
type Copy = (typeof copy)[UiLocale];

const cleanups: Array<() => void> = [];
const mount = (ui: ReactElement, locale: UiLocale) => {
  // The root layout wraps the app in TooltipProvider (titled buttons use it).
  const rendered = renderWithLocale(
    createElement(TooltipProvider, { delayDuration: 0, children: ui }),
    { locale },
  );
  cleanups.push(rendered.unmount);
  return rendered;
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
const labeledInput = (container: HTMLElement, text: string) => {
  const label = [...container.querySelectorAll("label")].find(
    (candidate) => candidate.textContent === text,
  )!;
  return document.getElementById(label.getAttribute("for")!) as HTMLInputElement;
};

beforeEach(() => {
  state.post.mockReset().mockResolvedValue({ id: "created-test" });
  state.push.mockReset();
  state.refresh.mockReset();
  state.accounts = [account];
  state.accountsError = null;
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Accounts page i18n (T19)", () => {
  it.each(["en", "zh-CN"] as UiLocale[])(
    "keeps the localized snapshot summary, delete confirmation and cancel behavior under %s",
    async (locale) => {
      const expected = copy[locale] as Copy;
      const { container } = mount(createElement(AccountsPage), locale);
      expect(container.textContent).toContain(expected.snapshotSummary);

      const confirmSpy = vi.fn(() => false);
      vi.stubGlobal("confirm", confirmSpy);
      // ui/button turns `title` into aria-label on icon buttons, so the
      // accessible name query below mirrors real assistive-tech lookup.
      const deleteButton = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${expected.deleteTitle}"]`,
      )!;
      await click(deleteButton);
      expect(confirmSpy).toHaveBeenCalledWith(expected.deleteConfirm);
      expect(state.post).not.toHaveBeenCalled();

      confirmSpy.mockReturnValue(true);
      await click(deleteButton);
      expect(state.post).toHaveBeenCalledWith("/api/accounts/acc-1", undefined, "DELETE");
    },
  );

  it.each(["en", "zh-CN"] as UiLocale[])(
    "creates an account through the localized form by accessible name under %s",
    async (locale) => {
      const expected = copy[locale] as Copy;
      const { container } = mount(createElement(AccountsPage), locale);
      await setValue(labeledInput(container, expected.nameLabel), "Testing");
      await click(buttonByText(container, expected.createButton));
      expect(state.post).toHaveBeenCalledWith("/api/accounts", {
        name: "Testing",
        kind: "manual",
        currency: "USD",
        initialBalance: 0,
      });
    },
  );

  it("patches the profit calculation from the localized cost-basis select (en)", async () => {
    const { container } = mount(createElement(AccountsPage), "en");
    const select = [...container.querySelectorAll("select")].find((candidate) =>
      [...candidate.options].some((option) => option.value === "lifo"),
    )!;
    await act(async () => {
      select.value = "lifo";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(state.post).toHaveBeenCalledWith(
      "/api/accounts/acc-1",
      { profitCalcMethod: "lifo" },
      "PATCH",
    );
  });
});

describe("Login page i18n (T19)", () => {
  it.each(["en", "zh-CN"] as UiLocale[])(
    "localizes the wrong-password message and still navigates on success under %s",
    async (locale) => {
      const expected = copy[locale] as Copy;
      state.post.mockRejectedValueOnce(
        new ApiError("Wrong password. Try again.", "wrong_password"),
      );
      const { container } = mount(createElement(LoginPage), locale);
      await setValue(container.querySelector<HTMLInputElement>('input[type="password"]')!, "nope");
      await click(buttonByText(container, expected.unlock));
      expect(container.querySelector("p")!.textContent).toBe(expected.wrongPassword);
      expect(state.push).not.toHaveBeenCalled();

      // The stale error keeps the existing behavior; success just navigates.
      await click(buttonByText(container, expected.unlock));
      expect(state.push).toHaveBeenCalledWith("/");
    },
  );
});
