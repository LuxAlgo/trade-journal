import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieJar } = vi.hoisted(() => ({
  cookieJar: {
    get: vi.fn<(name: string) => { value: string } | undefined>(),
    set: vi.fn<(...args: unknown[]) => void>(),
  },
}));

vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));

const { POST } = await import("../src/app/api/locale/route");

const call = (body: unknown) =>
  POST(
    new Request("http://localhost:3000/api/locale", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("POST /api/locale", () => {
  beforeEach(() => {
    cookieJar.get.mockReset();
    cookieJar.set.mockReset();
  });

  it("stores a valid locale in the NEXT_LOCALE cookie", async () => {
    const response = await call({ locale: "ja" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ locale: "ja" });
    expect(cookieJar.set).toHaveBeenCalledTimes(1);
    expect(cookieJar.set).toHaveBeenCalledWith("NEXT_LOCALE", "ja", {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      httpOnly: true,
    });
    const headers = response.headers;
    expect(headers.get("Cache-Control")).toContain("no-store");
  });

  it("accepts every supported locale code", async () => {
    for (const locale of ["en", "zh-CN", "ja", "ko", "zh-TW", "es", "fr"]) {
      cookieJar.set.mockClear();
      const response = await call({ locale });
      expect(response.status).toBe(200);
      expect(cookieJar.set.mock.calls[0]?.[1]).toBe(locale);
    }
  });

  it("rejects unknown locales with 400 and writes no cookie", async () => {
    for (const locale of ["xx", "EN", "en-US", "en/common", "../etc", 42, null]) {
      const response = await call({ locale });
      expect(response.status).toBe(400);
      // T16 added the stable code next to the unchanged error text.
      expect(await response.json()).toEqual({ error: "Invalid locale", code: "invalid_locale" });
    }
    expect(cookieJar.set).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies with 400 and writes no cookie", async () => {
    const missing = await call({});
    expect(missing.status).toBe(400);
    const nonJson = await call("not-json{");
    expect(nonJson.status).toBe(400);
    expect(cookieJar.set).not.toHaveBeenCalled();
  });
});
