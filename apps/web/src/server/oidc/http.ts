import { AUTH_COOKIE } from "../auth";
import { safeReturnTo } from "@/lib/auth-redirect";
import type { OidcErrorCode } from "./provider";

/** Cookie holding the id of a login in progress; only the OIDC routes see it. */
export const TRANSACTION_COOKIE = "journal_oidc_login";
const TRANSACTION_PATH = "/api/auth/oidc";

type CookieOptions = { maxAge: number; path: string; secure: boolean };

const cookie = (name: string, value: string, { maxAge, path, secure }: CookieOptions) =>
  [
    `${name}=${value}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    // Lax: sent on the provider's top-level redirect back, never on cross-site subrequests.
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");

export const transactionCookie = (value: string, secure: boolean) =>
  cookie(TRANSACTION_COOKIE, value, { maxAge: 600, path: TRANSACTION_PATH, secure });
export const clearTransactionCookie = (secure: boolean) =>
  cookie(TRANSACTION_COOKIE, "", { maxAge: 0, path: TRANSACTION_PATH, secure });
export const sessionCookie = (value: string, maxAge: number, secure: boolean) =>
  cookie(AUTH_COOKIE, value, { maxAge, path: "/", secure });
export const clearSessionCookie = (secure: boolean) =>
  cookie(AUTH_COOKIE, "", { maxAge: 0, path: "/", secure });

/** One cookie from a request's Cookie header. */
export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || undefined;
  }
  return undefined;
}

/**
 * A redirect within the journal, as a relative Location so a proxy in front of it never
 * sends the browser to an internal host name. Never cached.
 */
export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}

/** Back to the login page with a reason it can explain (a code, never provider text). */
export const loginError = (
  code: OidcErrorCode | "unexpected",
  returnTo: string,
  cookies: string[] = [],
) => {
  const params = new URLSearchParams({ error: code });
  const next = safeReturnTo(returnTo);
  if (next !== "/") params.set("next", next);
  return redirect(`/login?${params}`, cookies);
};

const reported = new Set<string>();
/** Log a configuration problem once (it names settings, never their values). */
export function reportConfigProblem(problem: string): string {
  if (!reported.has(problem)) {
    reported.add(problem);
    console.warn(`[oidc] single sign-on is misconfigured: ${problem}`);
  }
  return "Single sign-on is not configured correctly. The server log says what to fix.";
}
