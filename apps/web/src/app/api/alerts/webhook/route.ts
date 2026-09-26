import { handler, ok } from "@/server/api";
import { setWebhookUrl, webhookUrl } from "@/server/background-alerts/delivery";

/** Optional webhook (an ntfy topic, or any URL that accepts a text POST). */
export const PUT = handler(async (request: Request) => {
  const body = (await request.json()) as { url?: unknown } | null;
  setWebhookUrl(typeof body?.url === "string" && body.url.trim() ? body.url.trim() : null);
  return ok({ webhook: webhookUrl() });
});
