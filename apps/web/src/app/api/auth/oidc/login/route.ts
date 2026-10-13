import { handler } from "@/server/api";
import { safeReturnTo } from "@/lib/auth-redirect";
import { oidcConfig } from "@/server/oidc/config";
import { loginError, reportConfigProblem, transactionCookie } from "@/server/oidc/http";
import { logOidcFailure, OidcError, startLogin } from "@/server/oidc/provider";

/**
 * Start a sign-in: remember the login (state, nonce, PKCE verifier, where to return) and
 * send the browser to the provider's authorization endpoint.
 */
export const GET = handler(
  async (request: Request) => {
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get("next"));
    const config = oidcConfig();
    if (!config.enabled || !config.ok) {
      if (config.enabled && !config.ok) reportConfigProblem(config.problem);
      return loginError("config", returnTo);
    }
    try {
      const { url, transactionId } = await startLogin(returnTo);
      const headers = new Headers({ Location: url.href, "Cache-Control": "no-store" });
      headers.append(
        "Set-Cookie",
        transactionCookie(transactionId, config.settings.redirectUri.protocol === "https:"),
      );
      return new Response(null, { status: 303, headers });
    } catch (error) {
      logOidcFailure("sign-in start", error);
      return loginError(error instanceof OidcError ? error.code : "unexpected", returnTo);
    }
  },
  { public: true },
);
