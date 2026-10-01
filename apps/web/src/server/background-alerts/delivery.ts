import { eq } from "drizzle-orm";
import { decryptJson, encryptJson } from "../crypto";
import { deleteSetting, getSetting, setSetting } from "../settings";
import { RequestError } from "../api";
import { nowIso } from "../ids";
import { alertsDb, pushSubscriptions } from "./store";
import { generateVapidKeys, sendPush, type PushTarget, type VapidKeys } from "./web-push";

/**
 * Alert delivery: Web Push to every subscribed browser (Chrome, Firefox, Edge and Safari
 * carry it through their push services, encrypted end to end with this server's own VAPID
 * keys), and optionally one webhook such as an ntfy topic. Nothing else is contacted.
 */
const VAPID_PUBLIC = "push:vapidPublic";
const VAPID_PRIVATE = "push:vapidPrivateEnc";
const WEBHOOK = "alerts:webhookUrl";
/** A subscription that keeps failing is dropped (the browser went away). */
const MAX_FAILURES = 5;
/** The push services browsers use; subscriptions pointing anywhere else are refused. */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  ".push.services.mozilla.com",
  ".notify.windows.com",
  ".push.apple.com",
];

/** The server's VAPID keys, created once. New keys invalidate existing subscriptions. */
export function vapidKeys(): VapidKeys {
  const publicKey = getSetting(VAPID_PUBLIC);
  const saved = getSetting(VAPID_PRIVATE);
  if (publicKey && saved) {
    try {
      return { publicKey, privateKey: decryptJson<string>(saved) };
    } catch {
      // Unreadable (the secret changed): make new keys; browsers subscribe again.
    }
  }
  const keys = generateVapidKeys();
  setSetting(VAPID_PUBLIC, keys.publicKey);
  setSetting(VAPID_PRIVATE, encryptJson(keys.privateKey));
  alertsDb().delete(pushSubscriptions).run();
  return keys;
}

const subject = () => {
  const url = process.env.JOURNAL_PUBLIC_URL?.trim();
  return url && /^https:\/\//.test(url) ? url : "mailto:alerts@localhost";
};

const KEY = /^[A-Za-z0-9_-]{16,200}$/;

export function subscriptionProblem(value: unknown): string | null {
  const s = value as Partial<PushTarget> | null;
  if (!s || typeof s.endpoint !== "string" || s.endpoint.length > 1000)
    return "Invalid push subscription.";
  let url: URL;
  try {
    url = new URL(s.endpoint);
  } catch {
    return "Invalid push subscription.";
  }
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    !PUSH_HOSTS.some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h))
  )
    return "This push service is not supported.";
  if (!s.keys || !KEY.test(s.keys.p256dh ?? "") || !KEY.test(s.keys.auth ?? ""))
    return "Invalid push subscription keys.";
  return null;
}

export function saveSubscription(value: unknown, label: string) {
  const problem = subscriptionProblem(value);
  if (problem) throw new RequestError(problem);
  const s = value as PushTarget;
  const row = {
    endpoint: s.endpoint,
    p256dh: s.keys.p256dh,
    auth: s.keys.auth,
    label: label.slice(0, 120),
    createdAt: nowIso(),
    failures: 0,
  };
  alertsDb()
    .insert(pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: row.p256dh, auth: row.auth, label: row.label, failures: 0 },
    })
    .run();
}

export const removeSubscription = (endpoint: string) =>
  alertsDb().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run()
    .changes > 0;

export const listSubscriptions = () =>
  alertsDb()
    .select({
      endpoint: pushSubscriptions.endpoint,
      label: pushSubscriptions.label,
      createdAt: pushSubscriptions.createdAt,
      lastSuccessAt: pushSubscriptions.lastSuccessAt,
      failures: pushSubscriptions.failures,
    })
    .from(pushSubscriptions)
    .all();

export const webhookUrl = () => getSetting(WEBHOOK);

export function setWebhookUrl(url: string | null) {
  if (!url) return deleteSetting(WEBHOOK);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RequestError("Enter a full webhook URL, such as https://ntfy.sh/your-topic.");
  }
  if (!["https:", "http:"].includes(parsed.protocol) || url.length > 500)
    throw new RequestError("The webhook must be an http or https URL.");
  setSetting(WEBHOOK, parsed.toString());
}

export interface AlertNotification {
  title: string;
  body: string;
  tag: string;
  /** Opened when the notification is tapped (a path on this journal). */
  url: string;
}

/** Network access, replaced in tests. */
export const transport = { fetch: (url: string, init: RequestInit) => fetch(url, init) };

/** Send to every browser and the webhook; returns how many accepted it. */
export async function deliver(notification: AlertNotification): Promise<number> {
  const keys = vapidKeys();
  const payload = JSON.stringify(notification);
  const db = alertsDb();
  const rows = db.select().from(pushSubscriptions).all();
  const results = await Promise.all(
    rows.map(async (row) => {
      try {
        await sendPush(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
          { keys, subject: subject() },
          (url, init) => transport.fetch(String(url), init ?? {}),
        );
        db.update(pushSubscriptions)
          .set({ lastSuccessAt: nowIso(), failures: 0 })
          .where(eq(pushSubscriptions.endpoint, row.endpoint))
          .run();
        return 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410: the browser unsubscribed.
        if (status === 404 || status === 410 || row.failures + 1 >= MAX_FAILURES)
          removeSubscription(row.endpoint);
        else
          db.update(pushSubscriptions)
            .set({ failures: row.failures + 1 })
            .where(eq(pushSubscriptions.endpoint, row.endpoint))
            .run();
        return 0;
      }
    }),
  );
  let delivered = results.reduce<number>((a, b) => a + b, 0);
  const hook = webhookUrl();
  if (hook) {
    const origin = process.env.JOURNAL_PUBLIC_URL?.replace(/\/+$/, "");
    try {
      // ntfy reads Title/Tags/Click; any other webhook gets the text body.
      const response = await transport.fetch(hook, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          Title: notification.title,
          Tags: "chart_with_upwards_trend",
          ...(origin ? { Click: `${origin}${notification.url}` } : {}),
        },
        body: notification.body,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) delivered += 1;
    } catch {
      // Recorded as not delivered.
    }
  }
  return delivered;
}
