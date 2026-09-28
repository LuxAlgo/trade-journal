import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProvider, type TestProvider, type TokenOverrides } from "./oidc-provider-fixture";

const jar = vi.hoisted(() => ({ session: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "journal_session" && jar.session ? { value: jar.session } : undefined,
    set: () => {},
  }),
}));

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-oidc-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db } = await import("../src/db");
const { handler, ok } = await import("../src/server/api");
const { resetOidcDiscovery } = await import("../src/server/oidc/provider");
const authRoute = await import("../src/app/api/auth/route");
const loginRoute = await import("../src/app/api/auth/oidc/login/route");
const callbackRoute = await import("../src/app/api/auth/oidc/callback/route");
const logoutRoute = await import("../src/app/api/auth/logout/route");
const backchannelRoute = await import("../src/app/api/auth/oidc/backchannel-logout/route");

const APP = "http://localhost:3000";
const CLIENT_ID = "journal-client";
const CLIENT_SECRET = "s3cret-client-value-that-is-long-enough-for-hs256-0123456789";

let provider: TestProvider;
const warnings: string[] = [];

function configure(env: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    JOURNAL_PASSWORD: "",
    JOURNAL_OIDC_ISSUER: provider.issuer,
    JOURNAL_OIDC_CLIENT_ID: CLIENT_ID,
    JOURNAL_OIDC_CLIENT_SECRET: CLIENT_SECRET,
    JOURNAL_PUBLIC_URL: APP,
    JOURNAL_OIDC_ALLOW_HTTP: "true",
    JOURNAL_OIDC_ALLOWED_GROUPS: "traders",
    JOURNAL_OIDC_ALLOWED_EMAILS: undefined,
    JOURNAL_OIDC_ALLOWED_SUBJECTS: undefined,
    JOURNAL_OIDC_ALLOW_ALL_USERS: undefined,
    JOURNAL_OIDC_TRUST_UNVERIFIED_EMAIL: undefined,
    JOURNAL_OIDC_LOGOUT: undefined,
    JOURNAL_OIDC_REDIRECT_URI: undefined,
    JOURNAL_OIDC_SCOPES: undefined,
    JOURNAL_OIDC_SESSION_HOURS: undefined,
    ...env,
  };
  for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value ?? "");
  resetOidcDiscovery();
}

/** Every cookie a response sets, by name, with its attributes. */
function setCookies(response: Response) {
  const out = new Map<string, { value: string; attributes: string }>();
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split("; ");
    const [name, ...value] = pair!.split("=");
    out.set(name!, { value: value.join("="), attributes: attributes.join("; ") });
  }
  return out;
}

async function startLogin(next = "/trades") {
  const response = await loginRoute.GET(
    new Request(`${APP}/api/auth/oidc/login?${new URLSearchParams({ next })}`),
  );
  const location = response.headers.get("location") ?? "";
  const transaction = setCookies(response).get("journal_oidc_login")?.value;
  return { response, location, transaction };
}

/**
 * The provider's redirect back to the journal. The request reaches the app on an internal
 * address, as behind a proxy; the journal must still use the configured redirect URI.
 */
function callback(params: URLSearchParams, transaction: string | undefined) {
  return callbackRoute.GET(
    new Request(`http://0.0.0.0:3000/api/auth/oidc/callback?${params}`, {
      headers: transaction ? { cookie: `journal_oidc_login=${transaction}; other=1` } : {},
    }),
  );
}

/** A whole sign-in; returns the callback's response and the session cookie it set. */
async function signIn(overrides: TokenOverrides = {}, next = "/trades") {
  const { location, transaction } = await startLogin(next);
  const response = await callback(provider.authorize(location, overrides), transaction);
  return { response, session: setCookies(response).get("journal_session")?.value };
}

const errorOf = (response: Response) =>
  new URL(response.headers.get("location") ?? "", APP).searchParams.get("error");

const protectedRoute = handler(async () => ok({ secret: true }));
const canRead = async (session: string | undefined) => {
  jar.session = session;
  return (await protectedRoute()).status === 200;
};

beforeAll(async () => {
  provider = await startProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
});
beforeEach(() => {
  configure();
  warnings.length = 0;
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  jar.session = undefined;
});
afterAll(async () => {
  await provider.close();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("signing in with an OpenID Connect provider", () => {
  it("sends the browser to the provider with state, nonce and PKCE (S256)", async () => {
    const { response, location } = await startLogin();
    expect(response.status).toBe(303);
    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe(`${provider.origin}/application/o/authorize/`);
    const p = url.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(`${APP}/api/auth/oidc/callback`);
    expect(p.get("scope")).toBe("openid profile email");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("state")!.length).toBeGreaterThanOrEqual(32);
    expect(p.get("nonce")!.length).toBeGreaterThanOrEqual(32);
    expect(p.get("state")).not.toBe(p.get("nonce"));
    // The login in progress is bound to this browser by an HttpOnly, Lax cookie.
    const cookie = setCookies(response).get("journal_oidc_login")!;
    expect(cookie.value.length).toBeGreaterThanOrEqual(40);
    expect(cookie.attributes).toContain("HttpOnly");
    expect(cookie.attributes).toContain("SameSite=Lax");
    expect(cookie.attributes).toContain("Path=/api/auth/oidc");
    expect(cookie.attributes).toContain("Max-Age=600");
  });

  it("a valid callback opens a session and returns to the page you asked for", async () => {
    const { response, session } = await signIn();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/trades");
    expect(session).toMatch(/^o1\./);
    const cookies = setCookies(response);
    expect(cookies.get("journal_session")!.attributes).toContain("HttpOnly");
    expect(cookies.get("journal_session")!.attributes).toContain("Path=/");
    expect(cookies.get("journal_session")!.attributes).toContain(`Max-Age=${7 * 24 * 3600}`);
    // The login cookie is cleared: it was single use.
    expect(cookies.get("journal_oidc_login")!.attributes).toContain("Max-Age=0");
    expect(await canRead(session)).toBe(true);
    // The token request authenticated the client and proved the PKCE verifier.
    const tokenRequest = provider.requests
      .filter((r) => r.path === "/application/o/token/")
      .at(-1)!;
    expect(tokenRequest.headers.authorization).toMatch(/^Basic /);
    const form = new URLSearchParams(tokenRequest.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(form.get("redirect_uri")).toBe(`${APP}/api/auth/oidc/callback`);
  });

  it("says who is signed in, and stores only a hash of the session id", async () => {
    const { session } = await signIn();
    jar.session = session;
    const body = await (await authRoute.GET()).json();
    expect(body).toMatchObject({
      required: true,
      password: false,
      oidc: { label: "Single sign-on", problem: null },
      session: { method: "oidc", name: "Test Trader", email: "trader@example.com" },
    });
    const raw = session!.slice(3);
    const rows = db.$client.prepare("SELECT id_hash FROM auth_sessions").all() as {
      id_hash: string;
    }[];
    expect(rows.some((r) => r.id_hash === raw || r.id_hash.includes(raw))).toBe(false);
  });

  it("a forged or unknown session cookie is refused", async () => {
    expect(await canRead(undefined)).toBe(false);
    expect(await canRead("o1.forged-session-id")).toBe(false);
    expect(await canRead("0".repeat(64))).toBe(false);
  });

  it("each sign-in gets a new session id", async () => {
    const first = (await signIn()).session;
    const second = (await signIn()).session;
    expect(first).not.toBe(second);
    expect(await canRead(first)).toBe(true);
    expect(await canRead(second)).toBe(true);
  });

  it("an unsafe return path goes home instead of off-site", async () => {
    for (const next of ["//evil.example", "https://evil.example/x", "/\\evil.example"]) {
      const { response } = await signIn({}, next);
      expect(response.headers.get("location")).toBe("/");
    }
  });
});

describe("the callback refuses what it did not ask for", () => {
  it("replaying a callback fails: the login and the code are single use", async () => {
    const { location, transaction } = await startLogin();
    const params = provider.authorize(location);
    const first = await callback(params, transaction);
    expect(first.status).toBe(303);
    const replay = await callback(params, transaction);
    expect(errorOf(replay)).toBe("state");
    expect(setCookies(replay).has("journal_session")).toBe(false);
  });

  it("a callback without this browser's login cookie fails (login CSRF)", async () => {
    const { location } = await startLogin();
    const response = await callback(provider.authorize(location), undefined);
    expect(errorOf(response)).toBe("state");
    // Someone else's login cookie does not help either.
    const other = await startLogin();
    const mine = await startLogin();
    expect(errorOf(await callback(provider.authorize(mine.location), other.transaction))).toBe(
      "state",
    );
  });

  it("a response whose state differs from the login's fails", async () => {
    const { location, transaction } = await startLogin();
    const params = provider.authorize(location);
    params.set("state", "attacker-state-value");
    expect(errorOf(await callback(params, transaction))).toBe("state");
  });

  it("a login left for more than ten minutes expires", async () => {
    const { location, transaction } = await startLogin();
    db.$client.prepare("UPDATE oidc_login_transactions SET expires_at = ?").run(Date.now() - 1);
    expect(errorOf(await callback(provider.authorize(location), transaction))).toBe("state");
  });

  it("a code issued for another login fails the PKCE check", async () => {
    const victim = await startLogin();
    const attacker = await startLogin();
    // The attacker's code, injected into the victim's browser session.
    const params = provider.authorize(attacker.location);
    params.set("state", new URL(victim.location).searchParams.get("state")!);
    expect(errorOf(await callback(params, victim.transaction))).toBe("token");
  });

  it("the provider's own error is reported as a refusal", async () => {
    const { location, transaction } = await startLogin();
    const state = new URL(location).searchParams.get("state")!;
    const params = new URLSearchParams({
      error: "access_denied",
      error_description: "User cancelled",
      state,
      iss: provider.issuer,
    });
    expect(errorOf(await callback(params, transaction))).toBe("denied");
  });

  it("a response from another issuer (mix-up) fails", async () => {
    const { location, transaction } = await startLogin();
    const params = provider.authorize(location);
    params.set("iss", "https://evil.example/");
    expect(errorOf(await callback(params, transaction))).toBe("token");
  });
});

describe("ID tokens are validated before any session exists", () => {
  const cases: [string, TokenOverrides][] = [
    ["a different nonce", { claims: { nonce: "replayed-nonce" } }],
    ["another issuer", { claims: { iss: "https://evil.example/application/o/journal/" } }],
    ["another audience", { claims: { aud: "some-other-client" } }],
    [
      "an expired token",
      {
        claims: {
          exp: Math.floor(Date.now() / 1000) - 3600,
          iat: Math.floor(Date.now() / 1000) - 7200,
        },
      },
    ],
    ["a token issued in the future", { claims: { iat: Math.floor(Date.now() / 1000) + 3600 } }],
    ["no subject", { claims: { sub: undefined } }],
    ["a signature from another key", { sign: "other-key" }],
    ["an unsigned token (alg none)", { sign: "none" }],
    ["an HS256 token the provider does not advertise", { sign: "hs256" }],
    ["no ID token at all", { noIdToken: true }],
    ["several audiences without azp", { claims: { aud: [CLIENT_ID, "other"] } }],
  ];
  it.each(cases)("refuses %s", async (_name, overrides) => {
    const { response, session } = await signIn(overrides);
    expect(errorOf(response)).toBe("token");
    expect(session).toBeUndefined();
  });

  it("never logs codes, tokens or the client secret", async () => {
    const { location, transaction } = await startLogin();
    const params = provider.authorize(location, { sign: "other-key" });
    await callback(params, transaction);
    const logged = warnings.join("\n");
    expect(logged).toContain("[oidc]");
    expect(logged).not.toContain(params.get("code")!);
    expect(logged).not.toContain(CLIENT_SECRET);
    expect(logged).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(logged).not.toContain(transaction!);
  });
});

describe("providers that sign with the client secret (Authentik without a signing key)", () => {
  let hs: TestProvider;
  beforeAll(async () => {
    hs = await startProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, algs: ["HS256"] });
  });
  afterAll(() => hs.close());

  it("verifies HS256 ID tokens with the client secret", async () => {
    const saved = provider;
    provider = hs;
    try {
      configure();
      const { response, session } = await signIn({ sign: "hs256" });
      expect(response.headers.get("location")).toBe("/trades");
      expect(await canRead(session)).toBe(true);
      // An asymmetric token from the same provider is now the unexpected one.
      expect(errorOf((await signIn({ sign: "rs256" })).response)).toBe("token");
    } finally {
      provider = saved;
    }
  });
});

describe("public clients (no client secret)", () => {
  let publicProvider: TestProvider;
  beforeAll(async () => {
    publicProvider = await startProvider({
      clientId: CLIENT_ID,
      clientSecret: null,
      algs: ["RS256", "HS256"],
    });
  });
  afterAll(() => publicProvider.close());

  it("sign in with PKCE alone, and cannot accept tokens signed with a shared secret", async () => {
    const saved = provider;
    provider = publicProvider;
    try {
      configure({ JOURNAL_OIDC_CLIENT_SECRET: undefined });
      const { response, session } = await signIn();
      expect(response.headers.get("location")).toBe("/trades");
      expect(await canRead(session)).toBe(true);
      const tokenRequest = publicProvider.requests
        .filter((r) => r.path === "/application/o/token/")
        .at(-1)!;
      expect(tokenRequest.headers.authorization).toBeUndefined();
      expect(new URLSearchParams(tokenRequest.body).get("client_id")).toBe(CLIENT_ID);
      expect(errorOf((await signIn({ sign: "hs256" })).response)).toBe("token");
    } finally {
      provider = saved;
    }
  });
});

describe("who may sign in", () => {
  it("someone outside the allowed groups is refused and gets no session", async () => {
    const { response, session } = await signIn({ claims: { groups: ["guests"] } });
    expect(errorOf(response)).toBe("forbidden");
    expect(session).toBeUndefined();
  });

  it("an allowed subject is let in whatever their groups", async () => {
    configure({ JOURNAL_OIDC_ALLOWED_GROUPS: "", JOURNAL_OIDC_ALLOWED_SUBJECTS: "user-hash-1" });
    expect((await signIn({ claims: { groups: [] } })).session).toBeDefined();
    expect(errorOf((await signIn({ claims: { sub: "someone-else" } })).response)).toBe("forbidden");
  });

  it("an allowed email counts only when the provider verified it", async () => {
    configure({
      JOURNAL_OIDC_ALLOWED_GROUPS: "",
      JOURNAL_OIDC_ALLOWED_EMAILS: "Trader@Example.com",
    });
    expect((await signIn({ claims: { groups: [] } })).session).toBeDefined();
    const unverified = await signIn({ claims: { groups: [], email_verified: false } });
    expect(errorOf(unverified.response)).toBe("forbidden");
    configure({
      JOURNAL_OIDC_ALLOWED_GROUPS: "",
      JOURNAL_OIDC_ALLOWED_EMAILS: "trader@example.com",
      JOURNAL_OIDC_TRUST_UNVERIFIED_EMAIL: "true",
    });
    expect((await signIn({ claims: { groups: [], email_verified: false } })).session).toBeDefined();
  });

  it("groups missing from the ID token are read from userinfo", async () => {
    const { session } = await signIn({
      claims: { groups: undefined },
      userinfo: { sub: "user-hash-1", groups: ["traders"] },
    });
    expect(await canRead(session)).toBe(true);
    expect(provider.requests.some((r) => r.path === "/application/o/userinfo/")).toBe(true);
  });

  it("userinfo for another subject is refused (token substitution)", async () => {
    const { response, session } = await signIn({
      claims: { groups: undefined },
      userinfo: { sub: "attacker", groups: ["traders"] },
    });
    expect(errorOf(response)).toBe("unavailable");
    expect(session).toBeUndefined();
  });

  it("anyone the provider lets through, when told the provider decides", async () => {
    configure({ JOURNAL_OIDC_ALLOWED_GROUPS: "", JOURNAL_OIDC_ALLOW_ALL_USERS: "true" });
    expect((await signIn({ claims: { groups: [] } })).session).toBeDefined();
  });
});

describe("signing out", () => {
  it("ends the session on the server and sends you to the provider's end-session page", async () => {
    const { session } = await signIn();
    const response = await logoutRoute.POST(
      new Request(`${APP}/api/auth/logout`, {
        method: "POST",
        headers: { cookie: `journal_session=${session}` },
      }),
    );
    const { redirect } = (await response.json()) as { redirect: string };
    const url = new URL(redirect);
    expect(`${url.origin}${url.pathname}`).toBe(`${provider.issuer}end-session/`);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(`${APP}/login`);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("id_token_hint")).toMatch(/^eyJ/);
    expect(setCookies(response).get("journal_session")!.attributes).toContain("Max-Age=0");
    // A copy of the cookie is worthless now.
    expect(await canRead(session)).toBe(false);
  });

  it("with local logout, only the journal session ends", async () => {
    configure({ JOURNAL_OIDC_LOGOUT: "local" });
    const { session } = await signIn();
    const response = await logoutRoute.POST(
      new Request(`${APP}/api/auth/logout`, {
        method: "POST",
        headers: { cookie: `journal_session=${session}` },
      }),
    );
    expect(await response.json()).toEqual({ redirect: "/login" });
    expect(await canRead(session)).toBe(false);
  });

  it("a session past its lifetime is refused", async () => {
    const { session } = await signIn();
    db.$client.prepare("UPDATE auth_sessions SET expires_at = ?").run(Date.now() - 1);
    expect(await canRead(session)).toBe(false);
  });

  it("sessions belong to the configured issuer", async () => {
    const { session } = await signIn();
    configure({ JOURNAL_OIDC_ISSUER: `${provider.origin}/application/o/another-app/` });
    expect(await canRead(session)).toBe(false);
  });
});

describe("back-channel logout from the provider", () => {
  const post = (body: string, type = "application/x-www-form-urlencoded") =>
    backchannelRoute.POST(
      new Request(`${APP}/api/auth/oidc/backchannel-logout`, {
        method: "POST",
        headers: { "content-type": type },
        body,
      }),
    );

  it("a valid logout token ends that provider session's journal sessions", async () => {
    const { session } = await signIn();
    const other = (await signIn({ claims: { sid: "another-browser" } })).session;
    const response = await post(`logout_token=${await provider.logoutToken()}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await canRead(session)).toBe(false);
    expect(await canRead(other)).toBe(true);
  });

  it("a token naming only the subject ends all of that user's sessions", async () => {
    const { session } = await signIn();
    const response = await post(`logout_token=${await provider.logoutToken({ sid: undefined })}`);
    expect(response.status).toBe(200);
    expect(await canRead(session)).toBe(false);
  });

  const invalid: [string, Record<string, unknown>][] = [
    ["no logout event", { events: { "urn:other": {} } }],
    ["a nonce", { nonce: "n" }],
    ["another audience", { aud: "other-client" }],
    ["another issuer", { iss: "https://evil.example/" }],
    ["no jti", { jti: undefined }],
    ["neither sid nor sub", { sid: undefined, sub: undefined }],
    ["an old iat", { iat: Math.floor(Date.now() / 1000) - 3600 }],
  ];
  it.each(invalid)("refuses a logout token with %s", async (_name, claims) => {
    const { session } = await signIn();
    const response = await post(`logout_token=${await provider.logoutToken(claims)}`);
    expect(response.status).toBe(400);
    expect(await canRead(session)).toBe(true);
  });

  it("refuses a request that is not a form post with a logout token", async () => {
    expect((await post("logout_token=x", "application/json")).status).toBe(400);
    expect((await post("")).status).toBe(400);
    expect((await post("logout_token=not-a-jwt")).status).toBe(400);
  });
});

describe("configuration fails closed", () => {
  it("an incomplete configuration keeps the journal locked and says so", async () => {
    configure({ JOURNAL_OIDC_ALLOWED_GROUPS: "" });
    expect(await canRead(undefined)).toBe(false);
    const body = await (await authRoute.GET()).json();
    expect(body.required).toBe(true);
    expect(body.oidc.problem).toMatch(/not configured correctly/);
    // The details go to the server log, not to the public page.
    expect(JSON.stringify(body)).not.toContain("JOURNAL_OIDC");
    expect(warnings.join("\n")).toContain("JOURNAL_OIDC_ALLOWED_GROUPS");
    const { response } = await startLogin();
    expect(errorOf(response)).toBe("config");
  });

  it("an issuer whose discovery document names another issuer is refused", async () => {
    const mixUp = await startProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      advertisedIssuer: "https://evil.example/application/o/journal/",
    });
    try {
      configure({ JOURNAL_OIDC_ISSUER: mixUp.issuer });
      const { response } = await startLogin();
      expect(errorOf(response)).toBe("unavailable");
    } finally {
      await mixUp.close();
    }
  });

  it("an issuer missing its trailing slash is refused, with a hint for Authentik", async () => {
    configure({ JOURNAL_OIDC_ISSUER: provider.issuer.replace(/\/$/, "") });
    expect(errorOf((await startLogin()).response)).toBe("unavailable");
    expect(warnings.join("\n")).toMatch(/end with a slash/);
  });

  it("an unreachable provider is reported and retried on the next sign-in", async () => {
    configure({ JOURNAL_OIDC_ISSUER: "http://127.0.0.1:9/application/o/journal/" });
    expect(errorOf((await startLogin()).response)).toBe("unavailable");
    configure();
    expect((await startLogin()).response.headers.get("location")).toContain(provider.origin);
  });
});

describe("password sign-in alongside single sign-on", () => {
  it("both work when both are configured", async () => {
    configure({ JOURNAL_PASSWORD: "correct-horse" });
    const { sessionToken } = await import("../src/server/auth");
    expect(await canRead(sessionToken())).toBe(true);
    expect(await canRead((await signIn()).session)).toBe(true);
    const body = await (await authRoute.GET()).json();
    expect(body).toMatchObject({ password: true, oidc: { problem: null } });
  });

  it("signing out of a password session stays in the journal", async () => {
    configure({ JOURNAL_PASSWORD: "correct-horse" });
    const { sessionToken } = await import("../src/server/auth");
    const response = await logoutRoute.POST(
      new Request(`${APP}/api/auth/logout`, {
        method: "POST",
        headers: { cookie: `journal_session=${sessionToken()}` },
      }),
    );
    expect(await response.json()).toEqual({ redirect: "/login" });
    expect(setCookies(response).get("journal_session")!.attributes).toContain("Max-Age=0");
  });

  it("with only single sign-on, the password endpoint does not pretend to sign you in", async () => {
    const response = await authRoute.POST(
      new Request(`${APP}/api/auth`, { method: "POST", body: JSON.stringify({ password: "x" }) }),
    );
    expect(response.status).toBe(400);
  });
});
