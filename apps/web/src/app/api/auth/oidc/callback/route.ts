import { handler } from "@/server/api";
import { oidcConfig } from "@/server/oidc/config";
import {
  clearTransactionCookie,
  loginError,
  readCookie,
  redirect,
  sessionCookie,
  TRANSACTION_COOKIE,
} from "@/server/oidc/http";
import { finishLogin, logOidcFailure, OidcError } from "@/server/oidc/provider";

/**
 * The provider's redirect back (the registered redirect URI). Validates the response
 * against the login this browser started, exchanges the code and opens a session.
 */
export const GET = handler(
  async (request: Request) => {
    const config = oidcConfig();
    if (!config.enabled || !config.ok) return loginError("config", "/");
    const secure = config.settings.redirectUri.protocol === "https:";
    // The login is single use: its cookie goes whatever happens next.
    const clear = clearTransactionCookie(secure);
    try {
      const login = await finishLogin(
        new URL(request.url),
        readCookie(request, TRANSACTION_COOKIE),
      );
      return redirect(login.returnTo, [
        clear,
        sessionCookie(login.sessionCookie, login.maxAgeSeconds, secure),
      ]);
    } catch (error) {
      logOidcFailure("sign-in", error);
      return loginError(error instanceof OidcError ? error.code : "unexpected", "/", [clear]);
    }
  },
  { public: true },
);
