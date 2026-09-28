/**
 * Where to go after signing in: only a path on this journal. Anything else (another
 * origin, a protocol-relative `//host`, a backslash trick, a control character) falls back
 * to the home page, so a login link can never become an open redirect.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  let url: URL;
  try {
    url = new URL(value, "http://journal.invalid");
  } catch {
    return "/";
  }
  if (url.origin !== "http://journal.invalid") return "/";
  // Back to the login page or an API route is never where you meant to go.
  if (url.pathname === "/login" || url.pathname.startsWith("/api/")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
