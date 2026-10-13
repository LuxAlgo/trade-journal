import { AUTH_COOKIE } from "@/server/auth";
import { handler, ok } from "@/server/api";
import { oidcConfig } from "@/server/oidc/config";
import { clearSessionCookie, readCookie } from "@/server/oidc/http";
import { logout } from "@/server/oidc/provider";

/**
 * Sign out: the session ends here (a single sign-on session is deleted server-side, so the
 * cookie stops working even if it was copied). Answers where the browser goes next: the
 * provider's end-session page when provider logout is on, else the login page.
 */
export const POST = handler(
  async (request: Request) => {
    const token = readCookie(request, AUTH_COOKIE);
    const providerLogout = await logout(token);
    const config = oidcConfig();
    const secure =
      config.enabled && config.ok
        ? config.settings.redirectUri.protocol === "https:"
        : new URL(request.url).protocol === "https:";
    const response = ok({ redirect: providerLogout?.href ?? "/login" });
    response.headers.append("Set-Cookie", clearSessionCookie(secure));
    return response;
  },
  { public: true },
);
