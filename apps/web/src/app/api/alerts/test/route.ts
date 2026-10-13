import { handler, ok } from "@/server/api";
import { deliver } from "@/server/background-alerts/delivery";

/** Send a test notification to every browser and the webhook. */
export const POST = handler(async () =>
  ok({
    delivered: await deliver({
      title: "Test alert",
      body: "Background alerts reach this device.",
      tag: "alert-test",
      url: "/charts",
    }),
  }),
);
