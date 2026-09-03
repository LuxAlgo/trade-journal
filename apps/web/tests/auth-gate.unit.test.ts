import { afterEach, describe, expect, it, vi } from "vitest";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }),
}));

const { handler } = await import("../src/server/api");
const { sessionToken } = await import("../src/server/auth");
const route = handler(async () => new Response("secret", { status: 200 }));

afterEach(() => {
  delete process.env.JOURNAL_PASSWORD;
  cookieValue = undefined;
});

describe("optional password protection", () => {
  it("a forged session cookie is rejected when a password is configured", async () => {
    process.env.JOURNAL_PASSWORD = "correct-horse";
    cookieValue = "totally-forged";
    expect((await route()).status).toBe(401);
  });

  it("a missing cookie is rejected when a password is configured", async () => {
    process.env.JOURNAL_PASSWORD = "correct-horse";
    expect((await route()).status).toBe(401);
  });

  it("the real session cookie is accepted", async () => {
    process.env.JOURNAL_PASSWORD = "correct-horse";
    cookieValue = sessionToken();
    expect((await route()).status).toBe(200);
  });

  it("without a password the journal is open, as documented", async () => {
    expect((await route()).status).toBe(200);
  });

  it("a route marked public skips the gate so login itself can work", async () => {
    process.env.JOURNAL_PASSWORD = "correct-horse";
    const login = handler(async () => new Response("ok"), { public: true });
    expect((await login()).status).toBe(200);
  });
});
