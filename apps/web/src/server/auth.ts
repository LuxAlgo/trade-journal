import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Single-user auth, optional by design: it's your journal on your box. Set
 * JOURNAL_PASSWORD to require a login; the session cookie is an HMAC of the
 * password so rotating the password invalidates sessions.
 */
export const AUTH_COOKIE = "journal_session";

export const passwordConfigured = (): boolean => Boolean(process.env.JOURNAL_PASSWORD);

export const sessionToken = (): string =>
  createHmac("sha256", process.env.JOURNAL_PASSWORD ?? "")
    .update("session-v1")
    .digest("hex");

export const verifyPassword = (candidate: string): boolean => {
  const expected = Buffer.from(process.env.JOURNAL_PASSWORD ?? "", "utf8");
  const given = Buffer.from(candidate, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
};

export const verifySession = (token: string | undefined): boolean => {
  if (!passwordConfigured()) return true;
  if (!token) return false;
  const expected = Buffer.from(sessionToken(), "utf8");
  const given = Buffer.from(token, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
};
