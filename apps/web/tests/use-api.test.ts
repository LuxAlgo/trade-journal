// @vitest-environment jsdom
// GET-path error contract (docs/i18n.md §6, wave-4 T17 closeout): useApi keeps
// the stable code/params next to the unchanged English text (errorInfo), so
// formatApiError can localize GET failures exactly like the postJson path.
// Uncoded failures keep falling back to the raw English message.
import { act } from "react";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatApiError, ApiError } from "../src/lib/api-error";
import { postJson, useApi } from "../src/lib/use-api";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

// Root-level stand-in for next-intl's t: a dictionary with `has`, matching how
// pages pass useTranslations() into formatApiError.
const makeT = (entries: Record<string, string>) => {
  const t = (key: string, params?: Record<string, string | number>) => {
    let text = entries[key] ?? key;
    for (const [name, value] of Object.entries(params ?? {}))
      text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
  return Object.assign(t, { has: (key: string) => key in entries });
};

const t = makeT({ "errors.trade_not_found": "找不到该交易。（本地化）" });

const mount = (ui: ReactElement) => {
  const container = document.body.appendChild(document.createElement("div"));
  const root: Root = createRoot(container);
  act(() => root.render(ui));
  return {
    text: () => container.querySelector("p")!.textContent ?? "",
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const Probe = ({ url, translator = t }: { url: string | null; translator?: typeof t }) => {
  const { error, errorInfo } = useApi<{ ok: boolean }>(url);
  return createElement("p", null, formatApiError(translator, errorInfo ?? error));
};

describe("useApi GET error contract", () => {
  it("keeps code/params of a coded 404 so formatApiError localizes the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ error: "Trade not found", code: "trade_not_found" }, { status: 404 }),
        ),
      ),
    );
    const view = mount(createElement(Probe, { url: "/api/trades/missing" }));
    await act(async () => {});
    expect(view.text()).toBe("找不到该交易。（本地化）");
    view.unmount();
  });

  it("keeps ICU params intact when localizing a coded failure", async () => {
    const paramT = makeT({
      "errors.prop_conflict": "冲突：{message}（本地化）",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { error: "Conflict", code: "prop_conflict", params: { message: "stale" } },
            { status: 409 },
          ),
        ),
      ),
    );
    const view = mount(createElement(Probe, { url: "/api/prop-firms", translator: paramT }));
    await act(async () => {});
    expect(view.text()).toBe("冲突：stale（本地化）");
    view.unmount();
  });

  it("falls back to the raw English text when the 500 has no code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ error: "Boom" }, { status: 500 }))),
    );
    const view = mount(createElement(Probe, { url: "/api/stats" }));
    await act(async () => {});
    expect(view.text()).toBe("Boom");
    view.unmount();
  });

  it("keeps the English fallback for an unknown code (no masking, no guessing)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ error: "Long tail", code: "not_in_catalog" }, { status: 400 }),
        ),
      ),
    );
    const view = mount(createElement(Probe, { url: "/api/trades?view=list" }));
    await act(async () => {});
    expect(view.text()).toBe("Long tail");
    view.unmount();
  });

  it("keeps the legacy English string on `error` while errorInfo carries the code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ error: "Trade not found", code: "trade_not_found" }, { status: 404 }),
        ),
      ),
    );
    let seen: { error: string | null; errorInfo: unknown } | null = null;
    const Capture = () => {
      const state = useApi<{ ok: boolean }>("/api/trades/abc");
      seen = { error: state.error, errorInfo: state.errorInfo };
      return null;
    };
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    act(() => root.render(createElement(Capture)));
    await act(async () => {});
    expect(seen).toEqual({
      error: "Trade not found",
      errorInfo: { message: "Trade not found", code: "trade_not_found", params: undefined },
    });
    act(() => root.unmount());
    container.remove();
  });
});

describe("postJson error contract", () => {
  it("throws an ApiError carrying code/params for coded failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { error: "Wrong password. Try again.", code: "wrong_password" },
            { status: 401 },
          ),
        ),
      ),
    );
    const cause = await postJson("/api/auth", { password: "x" }).catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(ApiError);
    expect(cause).toMatchObject({
      message: "Wrong password. Try again.",
      code: "wrong_password",
    });
    expect(formatApiError(makeT({ "errors.wrong_password": "密码错误，请重试。" }), cause)).toBe(
      "密码错误，请重试。",
    );
  });

  it("throws an ApiError with the status text when the body has no error field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({}, { status: 502 }))),
    );
    const cause = await postJson("/api/ai/ask", {}).catch((e: unknown) => e);
    expect(cause).toMatchObject({ message: "Request failed (502)", code: undefined });
  });
});
