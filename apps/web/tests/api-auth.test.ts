import { afterEach, describe, expect, it, vi } from "vitest";
import { handler, ok } from "../src/server/api";
import { sessionToken, verifyPassword } from "../src/server/auth";

const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (session.token ? { value: session.token } : undefined) }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  session.token = undefined;
});

describe("optional journal password protection", () => {
  it("permits local access when no password is configured", async () => {
    vi.stubEnv("JOURNAL_PASSWORD", "");
    expect((await handler(() => ok({ data: true }))()).status).toBe(200);
  });
  it("rejects both missing and forged cookies before executing any handler", async () => {
    vi.stubEnv("JOURNAL_PASSWORD", "test-password");
    const action = vi.fn(() => ok({ secret: true }));
    for (const token of [undefined, "forged", "0".repeat(64)]) {
      session.token = token;
      expect((await handler(action)()).status).toBe(401);
    }
    expect(action).not.toHaveBeenCalled();
  });
  it("accepts signed sessions and invalidates them when the password changes", async () => {
    vi.stubEnv("JOURNAL_PASSWORD", "test-password");
    session.token = sessionToken();
    expect((await handler(() => ok({ data: true }))()).status).toBe(200);
    vi.stubEnv("JOURNAL_PASSWORD", "new-password");
    expect((await handler(() => ok({ data: true }))()).status).toBe(401);
  });
  it("allows the login endpoint to verify a password without a session", async () => {
    vi.stubEnv("JOURNAL_PASSWORD", "test-password");
    expect(verifyPassword("test-password")).toBe(true);
    expect(verifyPassword("wrong-password")).toBe(false);
    expect((await handler(() => ok({ login: true }), { public: true })()).status).toBe(200);
  });
});
