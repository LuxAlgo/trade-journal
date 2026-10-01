import { handler, ok, requireValue } from "@/server/api";
import {
  listSubscriptions,
  removeSubscription,
  saveSubscription,
  vapidKeys,
  webhookUrl,
} from "@/server/background-alerts/delivery";
import { runningAlertEngine } from "@/server/background-alerts/engine";

/** The server's push key, subscribed browsers, the webhook and whether the watcher runs. */
export const GET = handler(() =>
  ok({
    publicKey: vapidKeys().publicKey,
    devices: listSubscriptions(),
    webhook: webhookUrl(),
    running: runningAlertEngine() !== null,
  }),
);

/** Subscribe this browser: `{ subscription, label }` from PushManager.subscribe(). */
export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as { subscription?: unknown; label?: unknown } | null;
  saveSubscription(body?.subscription, typeof body?.label === "string" ? body.label : "");
  return ok({ devices: listSubscriptions() });
});

export const DELETE = handler(async (request: Request) => {
  const body = (await request.json()) as { endpoint?: unknown } | null;
  requireValue(typeof body?.endpoint === "string", "Choose a device.");
  removeSubscription(body.endpoint);
  return ok({ devices: listSubscriptions() });
});
