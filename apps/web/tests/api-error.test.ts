import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, formatApiError } from "../src/lib/api-error";
import { postJson } from "../src/lib/use-api";
import { acquireJson } from "../src/lib/api-request";

afterEach(() => vi.unstubAllGlobals());

/** Translator stand-in: has() mirrors next-intl, missing keys render as the key itself. */
const translator = (catalog: Record<string, string>) => {
  const t = (key: string, params?: Record<string, string | number>) => {
    const template = catalog[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
      String(params?.[name] ?? `{${name}}`),
    );
  };
  return Object.assign(t, { has: (key: string) => key in catalog });
};

describe("formatApiError", () => {
  const t = translator({
    "errors.wrong_password": "Wrong password. Try again.",
    "errors.open_trades_skipped": "{count} positions skipped.",
  });

  it("localizes an error carrying a known code", () => {
    expect(formatApiError(t, new ApiError("Wrong password", "wrong_password"))).toBe(
      "Wrong password. Try again.",
    );
  });

  it("passes params into the localized message", () => {
    expect(
      formatApiError(t, new ApiError("3 incomplete…", "open_trades_skipped", { count: 3 })),
    ).toBe("3 positions skipped.");
  });

  it("falls back to the original message when the code is absent from the catalog", () => {
    const err = new ApiError("Choose a different destination account.", "account_not_found");
    expect(formatApiError(translator({}), err)).toBe("Choose a different destination account.");
  });

  it("falls back when the error carries no code at all", () => {
    expect(formatApiError(t, new Error("Network error"))).toBe("Network error");
    expect(formatApiError(t, new ApiError("Save failed"))).toBe("Save failed");
    expect(formatApiError(t, "boom")).toBe("boom");
  });

  it("falls back when a translator without has() renders the key itself", () => {
    const bare = (key: string) => key; // next-intl's getMessageFallback shape
    expect(formatApiError(bare, new ApiError("Wrong password", "wrong_password"))).toBe(
      "Wrong password",
    );
  });
});

describe("client errors carry the server's code contract", () => {
  it("postJson attaches code and params to the thrown ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ error: "Wrong password", code: "wrong_password" }, { status: 401 }),
        ),
      ),
    );
    await expect(postJson("/api/auth", { password: "x" })).rejects.toMatchObject({
      message: "Wrong password",
      code: "wrong_password",
    });
  });

  it("postJson keeps the status-fallback message when the body has no error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({}, { status: 502 }))),
    );
    await expect(postJson("/api/x", {})).rejects.toMatchObject({
      message: "Request failed (502)",
      code: undefined,
    });
  });

  it("acquireJson attaches code and params from a failed GET", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ error: "Wrong password", code: "wrong_password" }, { status: 401 }),
        ),
      ),
    );
    const request = acquireJson<unknown>("/settings");
    await expect(request.promise).rejects.toMatchObject({
      message: "Wrong password",
      code: "wrong_password",
    });
    request.release();
  });
});
