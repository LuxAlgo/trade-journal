/**
 * OpenID Connect sign-in (Authentik, Keycloak, Zitadel, any standard provider), configured
 * from the environment. Setting `JOURNAL_OIDC_ISSUER` turns sign-in on; a configuration
 * that is incomplete or unsafe keeps the journal locked (it never falls back to open) and
 * the login page says what is wrong. Nothing here is secret except the client secret, which
 * is never returned, logged or sent to the browser.
 */

export type LogoutMode = "provider" | "local";

/** The environment, or any map of settings like it (tests). */
export type Env = Record<string, string | undefined>;

export interface OidcSettings {
  issuer: URL;
  clientId: string;
  /** Absent for a public client (PKCE only). */
  clientSecret: string | null;
  redirectUri: URL;
  scopes: string[];
  /** Who may sign in: any rule matching is enough. */
  allow: {
    subjects: string[];
    /** Lower-cased. Matched only against a verified email unless `trustUnverifiedEmail`. */
    emails: string[];
    groups: string[];
    any: boolean;
  };
  trustUnverifiedEmail: boolean;
  groupsClaim: string;
  label: string;
  logout: LogoutMode;
  sessionMaxAgeSeconds: number;
  /** Plain-HTTP issuer and redirect URI (a provider on your own machine). */
  allowHttp: boolean;
}

export type OidcConfigResult =
  | { enabled: false }
  | { enabled: true; ok: true; settings: OidcSettings }
  | { enabled: true; ok: false; problem: string };

const list = (value: string | undefined) =>
  (value ?? "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const flag = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "");

const isLoopback = (url: URL) =>
  url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";

const DEFAULT_SESSION_HOURS = 24 * 7;

/** `JOURNAL_OIDC_ISSUER` is set: the journal requires a sign-in, valid configuration or not. */
export const oidcEnabled = (env: Env = process.env) => Boolean(env.JOURNAL_OIDC_ISSUER?.trim());

let cached: { key: string; result: OidcConfigResult } | null = null;

export function oidcConfig(env: Env = process.env): OidcConfigResult {
  const key = Object.keys(env)
    .filter((name) => name.startsWith("JOURNAL_OIDC_") || name === "JOURNAL_PUBLIC_URL")
    .sort()
    .map((name) => `${name}=${env[name]}`)
    .join("\n");
  if (cached?.key === key) return cached.result;
  const result = parse(env);
  cached = { key, result };
  return result;
}

function parse(env: Env): OidcConfigResult {
  if (!oidcEnabled(env)) return { enabled: false };
  const fail = (problem: string): OidcConfigResult => ({ enabled: true, ok: false, problem });
  const allowHttp = flag(env.JOURNAL_OIDC_ALLOW_HTTP);

  let issuer: URL;
  try {
    issuer = new URL(env.JOURNAL_OIDC_ISSUER!.trim());
  } catch {
    return fail("JOURNAL_OIDC_ISSUER is not a URL.");
  }
  if (issuer.search || issuer.hash)
    return fail("JOURNAL_OIDC_ISSUER must be the issuer URL, without a query or fragment.");
  if (issuer.protocol !== "https:" && !(allowHttp && issuer.protocol === "http:"))
    return fail(
      "JOURNAL_OIDC_ISSUER must use https (set JOURNAL_OIDC_ALLOW_HTTP=true only for a provider on your own machine).",
    );

  const clientId = env.JOURNAL_OIDC_CLIENT_ID?.trim();
  if (!clientId) return fail("Set JOURNAL_OIDC_CLIENT_ID to the provider's client ID.");
  const clientSecret = env.JOURNAL_OIDC_CLIENT_SECRET?.trim() || null;

  const explicit = env.JOURNAL_OIDC_REDIRECT_URI?.trim();
  const publicUrl = env.JOURNAL_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (!explicit && !publicUrl)
    return fail(
      "Set JOURNAL_PUBLIC_URL (the address you open the journal at) or JOURNAL_OIDC_REDIRECT_URI.",
    );
  let redirectUri: URL;
  try {
    redirectUri = new URL(explicit || `${publicUrl}/api/auth/oidc/callback`);
  } catch {
    return fail("The redirect URI (JOURNAL_OIDC_REDIRECT_URI or JOURNAL_PUBLIC_URL) is not a URL.");
  }
  if (redirectUri.search || redirectUri.hash)
    return fail("JOURNAL_OIDC_REDIRECT_URI must not have a query or fragment.");
  if (redirectUri.pathname !== "/api/auth/oidc/callback")
    return fail("JOURNAL_OIDC_REDIRECT_URI must end in /api/auth/oidc/callback.");
  if (
    redirectUri.protocol !== "https:" &&
    !(redirectUri.protocol === "http:" && (allowHttp || isLoopback(redirectUri)))
  )
    return fail("The redirect URI must use https, except on localhost.");

  const scopes = list(env.JOURNAL_OIDC_SCOPES?.trim() || "openid profile email");
  if (!scopes.includes("openid")) return fail("JOURNAL_OIDC_SCOPES must include openid.");

  const allow = {
    subjects: list(env.JOURNAL_OIDC_ALLOWED_SUBJECTS),
    emails: list(env.JOURNAL_OIDC_ALLOWED_EMAILS).map((email) => email.toLowerCase()),
    groups: list(env.JOURNAL_OIDC_ALLOWED_GROUPS),
    any: flag(env.JOURNAL_OIDC_ALLOW_ALL_USERS),
  };
  if (!allow.any && !allow.subjects.length && !allow.emails.length && !allow.groups.length)
    return fail(
      "Say who may sign in: JOURNAL_OIDC_ALLOWED_GROUPS, JOURNAL_OIDC_ALLOWED_EMAILS or JOURNAL_OIDC_ALLOWED_SUBJECTS, or JOURNAL_OIDC_ALLOW_ALL_USERS=true when the provider already limits who can use this application.",
    );

  const logout = (env.JOURNAL_OIDC_LOGOUT?.trim().toLowerCase() || "provider") as LogoutMode;
  if (logout !== "provider" && logout !== "local")
    return fail("JOURNAL_OIDC_LOGOUT must be provider or local.");

  const hours = env.JOURNAL_OIDC_SESSION_HOURS?.trim()
    ? Number(env.JOURNAL_OIDC_SESSION_HOURS)
    : DEFAULT_SESSION_HOURS;
  if (!Number.isFinite(hours) || hours < 1 / 60 || hours > 24 * 365)
    return fail("JOURNAL_OIDC_SESSION_HOURS must be between 1 minute and a year, in hours.");

  return {
    enabled: true,
    ok: true,
    settings: {
      issuer,
      clientId,
      clientSecret,
      redirectUri,
      scopes,
      allow,
      trustUnverifiedEmail: flag(env.JOURNAL_OIDC_TRUST_UNVERIFIED_EMAIL),
      groupsClaim: env.JOURNAL_OIDC_GROUPS_CLAIM?.trim() || "groups",
      label: env.JOURNAL_OIDC_LABEL?.trim() || "Single sign-on",
      logout,
      sessionMaxAgeSeconds: Math.round(hours * 3600),
      allowHttp,
    },
  };
}
