"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Send, Smartphone, Trash2 } from "lucide-react";
import { postJson, useApi } from "@/lib/use-api";
import { fmtNumber } from "@/lib/utils";
import { Button } from "./ui/button";

interface PushState {
  publicKey: string;
  devices: { endpoint: string; label: string; createdAt: string; lastSuccessAt: string | null }[];
  webhook: string | null;
  running: boolean;
}

interface WatchState {
  watched: boolean;
  running: boolean;
  watch: {
    state: string;
    error: string | null;
    lines: number;
    zones: number;
    lastPrice: number | null;
  } | null;
}

interface AlertEvent {
  id: string;
  title: string;
  message: string;
  at: string;
  delivered: number;
}

/** VAPID public keys are base64url; PushManager wants the raw bytes. */
function keyBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const deviceLabel = () => {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "browser";
  return `${os} ${browser}`;
};

/**
 * Alerts that keep working with the page closed: the server watches this analysis's lines
 * and zones and pushes notifications to your browsers or a webhook. Self-contained: it
 * keeps its own state through /api/alerts, so the chart page only renders it.
 */
export function BackgroundAlerts({
  analysisId,
  disabledReason,
  ensureAnalysis,
}: {
  analysisId: string | null;
  /** Why the switch can't be used right now (a read-only day version). */
  disabledReason?: string;
  /** Saves the chart as an analysis when it has none yet; returns its id. */
  ensureAnalysis: () => Promise<string | null>;
}) {
  const { data: push, refresh } = useApi<PushState>("/api/alerts/push");
  const { data: watchState, refresh: refreshWatch } = useApi<WatchState>(
    analysisId ? `/api/alerts/watch?analysisId=${encodeURIComponent(analysisId)}` : null,
  );
  const enabled = Boolean(analysisId && watchState?.watched);
  const { data: events, refresh: refreshEvents } = useApi<{ events: AlertEvent[] }>(
    analysisId ? `/api/alerts/events?analysisId=${encodeURIComponent(analysisId)}` : null,
  );
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [webhook, setWebhook] = useState<string | null>(null);
  /** The switch shows the new state while it saves, and goes back if saving fails. */
  const [pending, setPending] = useState<boolean | null>(null);
  const checked = pending ?? enabled;

  const readSubscription = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext) {
      setSupported(false);
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    setEndpoint(subscription?.endpoint ?? null);
  }, []);
  useEffect(() => void readSubscription(), [readSubscription]);
  useEffect(() => {
    const timer = setInterval(() => {
      refreshWatch();
      refreshEvents();
    }, 15_000);
    return () => clearInterval(timer);
  }, [refreshWatch, refreshEvents]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const enableDevice = () =>
    run(async () => {
      if (!push) return;
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(
          "Notifications are blocked for this site. Allow them in the browser settings.",
        );
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(push.publicKey) as BufferSource,
      });
      await postJson("/api/alerts/push", {
        subscription: subscription.toJSON(),
        label: deviceLabel(),
      });
      setEndpoint(subscription.endpoint);
      refresh();
    });

  const removeDevice = (target: string) =>
    run(async () => {
      if (target === endpoint) {
        const registration = await navigator.serviceWorker.getRegistration("/");
        await (await registration?.pushManager.getSubscription())?.unsubscribe();
        setEndpoint(null);
      }
      await postJson("/api/alerts/push", { endpoint: target }, "DELETE");
      refresh();
    });

  const test = () =>
    run(async () => {
      const result = await postJson<{ delivered: number }>("/api/alerts/test", {});
      setMessage(
        result.delivered
          ? `Sent to ${result.delivered} destination${result.delivered === 1 ? "" : "s"}.`
          : "Nothing received it. Turn on notifications in a browser or add a webhook first.",
      );
      refresh();
    });

  const saveWebhook = () =>
    run(async () => {
      await postJson("/api/alerts/webhook", { url: webhook ?? "" }, "PUT");
      setWebhook(null);
      refresh();
    });

  const watch = watchState?.watch;
  const thisDevice = endpoint && push?.devices.some((d) => d.endpoint === endpoint);

  return (
    <div className="space-y-2 border-t pt-2">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          disabled={busy || Boolean(disabledReason)}
          onChange={(e) => {
            const next = e.target.checked;
            setPending(next);
            void run(async () => {
              try {
                const id = analysisId ?? (await ensureAnalysis());
                if (!id) throw new Error("Draw something first, so there is an analysis to watch.");
                await postJson("/api/alerts/watch", { analysisId: id, watched: next }, "PUT");
                refreshWatch();
              } finally {
                setPending(null);
              }
            });
          }}
        />
        <span>
          Keep watching when this page is closed
          <span className="block text-xs text-muted-foreground">
            {disabledReason ??
              "The server checks this analysis's lines and zones and notifies you. Indicator alerts only run while the chart is open."}
          </span>
        </span>
      </label>
      {checked && watch && (
        <p className="text-xs text-muted-foreground" role="status">
          {watch.state === "error"
            ? `Not watching: ${watch.error}`
            : `Watching ${watch.lines} line${watch.lines === 1 ? "" : "s"} and ${watch.zones} zone${watch.zones === 1 ? "" : "s"}${watch.state === "polling" ? " (checked periodically)" : watch.state === "live" ? " in real time" : ""}${watch.lastPrice !== null ? ` · last ${fmtNumber(watch.lastPrice)}` : ""}.`}
        </p>
      )}
      {checked && watchState && !watchState.running && (
        <p className="text-xs text-destructive">
          The background watcher is not running on the server (JOURNAL_BACKGROUND_ALERTS=off).
        </p>
      )}
      {checked && !watch && watchState?.running && (
        <p className="text-xs text-muted-foreground">
          Draw a horizontal line, ray or trend line, or add a zone, to have something to watch.
        </p>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium">Notify</p>
        {!supported ? (
          <p className="text-xs text-muted-foreground">
            This browser can&apos;t receive push notifications here. Use Chrome, Edge, Firefox or
            Safari with the journal on https (or localhost).
          </p>
        ) : thisDevice ? (
          <p className="flex items-center gap-1.5 text-xs">
            <Smartphone className="size-3.5" aria-hidden="true" /> This browser receives alerts.
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !push}
            onClick={() => void enableDevice()}
          >
            <BellRing /> Notify this browser
          </Button>
        )}
        {push && push.devices.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {push.devices.map((device) => (
              <li key={device.endpoint} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {device.label || "Device"}
                  {device.endpoint === endpoint ? " (this one)" : ""}
                  {device.lastSuccessAt
                    ? ` · last ${new Date(device.lastSuccessAt).toLocaleDateString()}`
                    : ""}
                </span>
                <button
                  type="button"
                  aria-label={`Stop notifying ${device.label || "this device"}`}
                  className="hover:text-destructive"
                  onClick={() => void removeDevice(device.endpoint)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-1">
          <input
            value={webhook ?? push?.webhook ?? ""}
            onChange={(e) => setWebhook(e.target.value)}
            placeholder="Webhook, e.g. https://ntfy.sh/your-topic"
            aria-label="Webhook URL for alerts"
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
          />
          {webhook !== null && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void saveWebhook()}
            >
              Save
            </Button>
          )}
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void test()}>
          <Send /> Send a test
        </Button>
        {message && (
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
        )}
      </div>

      {events && events.events.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Sent by the server</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {events.events.map((event) => (
              <li key={event.id}>
                {event.message}
                <span className="block text-muted-foreground">
                  {new Date(event.at).toLocaleString()}
                  {event.delivered ? "" : " · not delivered"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
