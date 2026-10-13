import { NextResponse, type NextRequest } from "next/server";
import { isPublicAppAsset } from "@/lib/pwa";

/**
 * Auth guard (only active when JOURNAL_PASSWORD or JOURNAL_OIDC_ISSUER is set). The
 * session cookie is validated for presence here and cryptographically in API handlers —
 * the middleware runtime has no Node crypto or database, so it gates navigation while the
 * handlers gate data.
 */
export const middleware = (request: NextRequest) => {
  if (!process.env.JOURNAL_PASSWORD && !process.env.JOURNAL_OIDC_ISSUER?.trim())
    return NextResponse.next();
  const { pathname } = request.nextUrl;
  // Sign-in itself: the login page, and the auth endpoints (each checks what it needs).
  if (pathname === "/login" || pathname === "/api/auth" || pathname.startsWith("/api/auth/"))
    return NextResponse.next();
  if (isPublicAppAsset(pathname)) return NextResponse.next();
  const cookie = request.cookies.get("journal_session")?.value;
  if (!cookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
};

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
