import { createHmac, timingSafeEqual } from "node:crypto";
import { oidcConfig, oidcEnabled } from "./oidc/config";
import { findSession, OIDC_SESSION_PREFIX, type SessionInfo } from "./oidc/store";

/**
 * Single-user auth, optional by design: it's your journal on your box. Set
 * JOURNAL_PASSWORD to require a login; the session cookie is an HMAC of the
 * password so rotating the password invalidates sessions. Set JOURNAL_OIDC_ISSUER
 * (see server/oidc) to sign in through an OpenID Connect provider instead or as well;
 * those sessions are random ids stored server-side, ended by signing out.
 */
export const AUTH_COOKIE = "journal_session";

export const passwordConfigured = (): boolean => Boolean(process.env.JOURNAL_PASSWORD);

/**
 * Whether the journal requires a sign-in. An OIDC issuer counts even when the rest of its
 * configuration is wrong: a broken sign-in keeps the journal locked, never open.
 */
export const authRequired = (): boolean => passwordConfigured() || oidcEnabled();

export const sessionToken = (): string =>
  createHmac("sha256", process.env.JOURNAL_PASSWORD ?? "")
    .update("session-v1")
    .digest("hex");

export const verifyPassword = (candidate: string): boolean => {
  const expected = Buffer.from(process.env.JOURNAL_PASSWORD ?? "", "utf8");
  const given = Buffer.from(candidate, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
};

const passwordSession = (token: string) => {
  if (!passwordConfigured()) return false;
  const expected = Buffer.from(sessionToken(), "utf8");
  const given = Buffer.from(token, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
};

/** The signed-in OIDC session behind a cookie, when sign-in is configured and it is live. */
export const oidcSession = (token: string | undefined): SessionInfo | null => {
  if (!token?.startsWith(OIDC_SESSION_PREFIX)) return null;
  const config = oidcConfig();
  if (!config.enabled || !config.ok) return null;
  return findSession(token, config.settings.issuer.href);
};

export const verifySession = (token: string | undefined): boolean => {
  if (!authRequired()) return true;
  if (!token) return false;
  if (token.startsWith(OIDC_SESSION_PREFIX)) return oidcSession(token) !== null;
  return passwordSession(token);
};
