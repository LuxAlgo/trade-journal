import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { oidcConfig, type Env } from "../src/server/oidc/config";
import { identityFrom, isAllowed } from "../src/server/oidc/provider";
import { safeReturnTo } from "../src/lib/auth-redirect";
import { middleware } from "../src/middleware";

const base = {
  JOURNAL_OIDC_ISSUER: "https://auth.example.com/application/o/trade-journal/",
  JOURNAL_OIDC_CLIENT_ID: "journal",
  JOURNAL_OIDC_CLIENT_SECRET: "secret",
  JOURNAL_PUBLIC_URL: "https://journal.example.com/",
  JOURNAL_OIDC_ALLOWED_GROUPS: "traders, admins",
} as Env;

const problem = (env: Env) => {
  const result = oidcConfig(env);
  return result.enabled && !result.ok ? result.problem : null;
};
const settings = (env: Env = base) => {
  const result = oidcConfig(env);
  if (!result.enabled || !result.ok) throw new Error("expected a valid configuration");
  return result.settings;
};

describe("single sign-on configuration", () => {
  it("is off until an issuer is set", () => {
    expect(oidcConfig({})).toEqual({ enabled: false });
  });

  it("derives the redirect URI from the public URL, with secure defaults", () => {
    const s = settings();
    expect(s.redirectUri.href).toBe("https://journal.example.com/api/auth/oidc/callback");
    expect(s.scopes).toEqual(["openid", "profile", "email"]);
    expect(s.allow).toEqual({
      subjects: [],
      emails: [],
      groups: ["traders", "admins"],
      any: false,
    });
    expect(s.logout).toBe("provider");
    expect(s.groupsClaim).toBe("groups");
    expect(s.sessionMaxAgeSeconds).toBe(7 * 24 * 3600);
    expect(s.trustUnverifiedEmail).toBe(false);
    expect(s.allowHttp).toBe(false);
  });

  it("blank settings mean their defaults, as an unset variable in a compose file does", () => {
    const s = settings({
      ...base,
      JOURNAL_OIDC_SCOPES: "",
      JOURNAL_OIDC_LOGOUT: "",
      JOURNAL_OIDC_SESSION_HOURS: "",
      JOURNAL_OIDC_CLIENT_SECRET: "",
    });
    expect(s.scopes).toEqual(["openid", "profile", "email"]);
    expect(s.logout).toBe("provider");
    expect(s.clientSecret).toBeNull();
  });

  it.each<[string, Env, RegExp]>([
    ["a plain-HTTP issuer", { JOURNAL_OIDC_ISSUER: "http://auth.example.com/" }, /https/],
    ["an issuer that is not a URL", { JOURNAL_OIDC_ISSUER: "auth" }, /not a URL/],
    ["an issuer with a query", { JOURNAL_OIDC_ISSUER: "https://a.example/?x=1" }, /query/],
    ["no client id", { JOURNAL_OIDC_CLIENT_ID: "" }, /CLIENT_ID/],
    ["no public URL or redirect URI", { JOURNAL_PUBLIC_URL: "" }, /JOURNAL_PUBLIC_URL/],
    [
      "a redirect URI elsewhere than the callback",
      { JOURNAL_OIDC_REDIRECT_URI: "https://journal.example.com/callback" },
      /api\/auth\/oidc\/callback/,
    ],
    [
      "a plain-HTTP redirect URI off localhost",
      { JOURNAL_PUBLIC_URL: "http://journal.example.com" },
      /https/,
    ],
    ["scopes without openid", { JOURNAL_OIDC_SCOPES: "profile email" }, /openid/],
    ["nobody allowed", { JOURNAL_OIDC_ALLOWED_GROUPS: "" }, /who may sign in/],
    ["an unknown logout mode", { JOURNAL_OIDC_LOGOUT: "everywhere" }, /provider or local/],
    ["a session lifetime of zero", { JOURNAL_OIDC_SESSION_HOURS: "0" }, /SESSION_HOURS/],
  ])("refuses %s", (_name, patch, message) => {
    expect(problem({ ...base, ...patch })).toMatch(message);
  });

  it("allows plain HTTP for a provider and journal on your own machine", () => {
    expect(
      settings({ ...base, JOURNAL_PUBLIC_URL: "http://localhost:3000" }).redirectUri.protocol,
    ).toBe("http:");
    const local = settings({
      ...base,
      JOURNAL_OIDC_ISSUER: "http://localhost:9000/application/o/trade-journal/",
      JOURNAL_OIDC_ALLOW_HTTP: "true",
      JOURNAL_PUBLIC_URL: "http://journal.lan:3000",
    });
    expect(local.issuer.protocol).toBe("http:");
  });

  it("an explicit redirect URI wins over the public URL", () => {
    expect(
      settings({
        ...base,
        JOURNAL_OIDC_REDIRECT_URI: "https://other.example.com/api/auth/oidc/callback",
      }).redirectUri.href,
    ).toBe("https://other.example.com/api/auth/oidc/callback");
  });
});

describe("mapping and allowing an identity", () => {
  const s = settings({
    ...base,
    JOURNAL_OIDC_ALLOWED_EMAILS: "Me@Example.com",
    JOURNAL_OIDC_ALLOWED_SUBJECTS: "abc123",
  });

  it("reads subject, email, name, groups and provider session from the claims", () => {
    expect(
      identityFrom(
        {
          sub: "abc123",
          email: "ME@example.com",
          email_verified: true,
          preferred_username: "me",
          groups: ["traders", 7, " admins "],
          sid: "s-1",
        },
        s,
      ),
    ).toEqual({
      subject: "abc123",
      email: "me@example.com",
      emailVerified: true,
      name: "me",
      groups: ["traders", "admins"],
      sid: "s-1",
    });
    // A single group as a string, and a custom groups claim.
    expect(
      identityFrom({ sub: "x", roles: "admins" }, { ...s, groupsClaim: "roles" }).groups,
    ).toEqual(["admins"]);
  });

  it("requires a subject", () => {
    expect(() => identityFrom({ email: "me@example.com" }, s)).toThrow(/subject/);
  });

  it("email_verified must be the boolean true", () => {
    for (const value of ["true", 1, "yes", undefined])
      expect(identityFrom({ sub: "x", email_verified: value }, s).emailVerified).toBe(false);
  });

  it("any one rule lets you in; none refuses", () => {
    const who = (patch: Record<string, unknown>) =>
      isAllowed(identityFrom({ sub: "nobody", ...patch }, s), s);
    expect(who({ sub: "abc123" })).toBe(true);
    expect(who({ groups: ["admins"] })).toBe(true);
    expect(who({ email: "me@example.com", email_verified: true })).toBe(true);
    expect(who({ email: "me@example.com", email_verified: false })).toBe(false);
    expect(who({ groups: ["Traders"] })).toBe(false);
    expect(who({ preferred_username: "abc123" })).toBe(false);
    expect(who({})).toBe(false);
  });
});

describe("returning after sign-in", () => {
  it("keeps paths on the journal", () => {
    expect(safeReturnTo("/trades?symbol=ES#top")).toBe("/trades?symbol=ES#top");
    expect(safeReturnTo("/journal/2026-09-28")).toBe("/journal/2026-09-28");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/%0a//evil.example".replace("%0a", "\n"),
    "javascript:alert(1)",
    "evil.example",
    "",
    "/login",
    "/api/auth/logout",
    "/" + "a".repeat(2001),
    null,
    42,
  ])("sends %j home instead", (value) => {
    expect(safeReturnTo(value)).toBe("/");
  });
});

describe("the navigation gate", () => {
  afterEach(() => vi.unstubAllEnvs());
  const visit = (path: string, cookie?: string) =>
    middleware(
      new NextRequest(`https://journal.example.com${path}`, {
        headers: cookie ? { cookie: `journal_session=${cookie}` } : {},
      }),
    );

  it("with only single sign-on configured, pages need a session", () => {
    vi.stubEnv("JOURNAL_PASSWORD", "");
    vi.stubEnv("JOURNAL_OIDC_ISSUER", base.JOURNAL_OIDC_ISSUER!);
    const page = visit("/trades?view=open");
    expect(page.status).toBe(307);
    const location = new URL(page.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/trades?view=open");
    expect(visit("/api/trades").status).toBe(401);
    expect(visit("/trades", "o1.something").headers.get("location")).toBeNull();
  });

  it("sign-in endpoints stay reachable without a session", () => {
    vi.stubEnv("JOURNAL_OIDC_ISSUER", base.JOURNAL_OIDC_ISSUER!);
    for (const path of [
      "/login",
      "/api/auth",
      "/api/auth/oidc/login",
      "/api/auth/oidc/callback",
      "/api/auth/oidc/backchannel-logout",
      "/api/auth/logout",
    ])
      expect(visit(path).headers.get("location")).toBeNull();
    expect(visit("/api/authx").status).toBe(401);
  });

  it("with neither password nor single sign-on the journal stays open, as before", () => {
    vi.stubEnv("JOURNAL_PASSWORD", "");
    vi.stubEnv("JOURNAL_OIDC_ISSUER", "");
    expect(visit("/trades").headers.get("location")).toBeNull();
  });
});
