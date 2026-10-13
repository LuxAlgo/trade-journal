import { handler } from "@/server/api";
import { oidcConfig } from "@/server/oidc/config";
import { backchannelLogout, logOidcFailure } from "@/server/oidc/provider";

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });

/**
 * OIDC Back-Channel Logout 1.0: the provider posts a signed logout token when a user's
 * session ends there, and the journal ends the matching sessions. Register this URL as the
 * provider's back-channel logout URI.
 */
export const POST = handler(
  async (request: Request) => {
    const config = oidcConfig();
    if (!config.enabled || !config.ok) return reply(404);
    const type = request.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded"))
      return reply(400, { error: "invalid_request" });
    const token = new URLSearchParams(await request.text()).get("logout_token");
    if (!token) return reply(400, { error: "invalid_request" });
    try {
      await backchannelLogout(token);
      return reply(200);
    } catch (error) {
      logOidcFailure("back-channel logout", error);
      return reply(400, { error: "invalid_request" });
    }
  },
  { public: true },
);
