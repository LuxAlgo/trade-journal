import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Contract spot-checks for the stable `code` field added by T16: the body keeps
 * `{ error, status }` semantics; `code` is strictly additive and both the
 * handler fallback and the middleware emit machine-stable generic codes.
 */
const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (session.token ? { value: session.token } : undefined) }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  session.token = undefined;
});

describe("handler error contract", () => {
  it("adds code to RequestError responses and keeps status 400", async () => {
    const { handler, RequestError } = await import("../src/server/api");
    const route = handler(async (_request: Request) => {
      throw new RequestError("Wrong password", "wrong_password");
    });
    const response = await route(new Request("http://localhost/api/x"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Wrong password", code: "wrong_password" });
  });

  it("emits the sanitized message without a code for uncoded validation errors", async () => {
    const { handler, RequestError } = await import("../src/server/api");
    const route = handler(async (_request: Request) => {
      throw new RequestError("Choose a different destination account.");
    });
    const response = await route(new Request("http://localhost/api/x"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Choose a different destination account." });
  });

  it("maps unknown and third-party failures to internal_error without changing status", async () => {
    const { handler } = await import("../src/server/api");
    const throwing = handler(async (_request: Request): Promise<Response> => {
      throw new Error("getaddrinfo ENOTFOUND api.provider.com");
    });
    const response = await throwing(new Request("http://localhost/api/x"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "getaddrinfo ENOTFOUND api.provider.com",
      code: "internal_error",
    });
  });

  it("maps non-Error throws to the sanitized internal message", async () => {
    const { handler } = await import("../src/server/api");
    const route = handler(async (_request: Request): Promise<Response> => {
      throw "nope";
    });
    const response = await route(new Request("http://localhost/api/x"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal error", code: "internal_error" });
  });

  it("bad() carries optional code and params next to the stable error text", async () => {
    const { bad } = await import("../src/server/api");
    const plain = await bad("Invalid locale", 400).json();
    expect(plain).toEqual({ error: "Invalid locale" });
    const coded = await bad("Wrong password", 401, "wrong_password").json();
    expect(coded).toEqual({ error: "Wrong password", code: "wrong_password" });
    const withParams = await bad("No Trades section found.", 400, "section_not_found").json();
    expect(withParams).toEqual({ error: "No Trades section found.", code: "section_not_found" });
  });

  it("returns 401 with code unauthorized when no valid session cookie is present", async () => {
    vi.stubEnv("JOURNAL_PASSWORD", "test-password");
    const { handler, ok } = await import("../src/server/api");
    const action = vi.fn((_request: Request) => ok({ secret: true }));
    const response = await handler(action)(new Request("http://localhost/api/x"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized", code: "unauthorized" });
    expect(action).not.toHaveBeenCalled();
  });
});

describe("route-level code spot-checks", () => {
  it("POST /api/locale rejects unknown locales with code invalid_locale", async () => {
    const { POST } = await import("../src/app/api/locale/route");
    const response = await POST(
      new Request("http://localhost/api/locale", {
        method: "POST",
        body: JSON.stringify({ locale: "xx" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid locale", code: "invalid_locale" });
  });

  it("POST /api/auth rejects a wrong password with code wrong_password", async () => {
    vi.stubEnv("JOURNAL_PASSWORD", "test-password");
    const { POST } = await import("../src/app/api/auth/route");
    const response = await POST(
      new Request("http://localhost/api/auth", {
        method: "POST",
        body: JSON.stringify({ password: "wrong" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Wrong password", code: "wrong_password" });
  });
});

describe("middleware 401 contract", () => {
  it("attaches code unauthorized to the JSON 401 without changing the text", async () => {
    vi.stubEnv("JOURNAL_PASSWORD", "test-password");
    const { middleware } = await import("../src/middleware");
    const { NextRequest } = await import("next/server");
    const request = new NextRequest("http://localhost:3000/api/trades") as NextRequest;
    const response = middleware(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized", code: "unauthorized" });
  });
});
