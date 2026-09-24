interface PendingRequest {
  controller: AbortController;
  promise: Promise<unknown>;
  users: number;
}

const pending = new Map<string, PendingRequest>();
const metadataCache = new Map<string, { value: unknown; expiresAt: number }>();
const METADATA_TTL_MS = 30_000;
const cacheableMetadata = new Set([
  "/api/settings?scope=timezone",
  "/api/accounts?summary=1",
  "/api/playbooks",
]);

export const invalidateMetadataCache = (): void => metadataCache.clear();

/** Share in-flight GETs; retain only small, non-financial directories briefly. */
export function acquireJson<T>(url: string): { promise: Promise<T>; release: () => void } {
  const cached = metadataCache.get(url);
  if (cached && cached.expiresAt > Date.now())
    return { promise: Promise.resolve(cached.value as T), release: () => undefined };
  if (cached) metadataCache.delete(url);

  let request = pending.get(url);
  if (!request) {
    const controller = new AbortController();
    const next: PendingRequest = { controller, users: 0, promise: Promise.resolve() };
    next.promise = fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
        if (cacheableMetadata.has(url))
          metadataCache.set(url, { value: body, expiresAt: Date.now() + METADATA_TTL_MS });
        return body;
      })
      .finally(() => {
        if (pending.get(url) === next) pending.delete(url);
      });
    request = next;
    pending.set(url, request);
  }
  const shared = request;
  shared.users++;
  let released = false;
  return {
    promise: shared.promise as Promise<T>,
    release: () => {
      if (released) return;
      released = true;
      shared.users--;
      // React Strict Mode can immediately reattach the same subscriber.
      queueMicrotask(() => {
        if (shared.users === 0 && pending.get(url) === shared) {
          pending.delete(url);
          shared.controller.abort();
        }
      });
    },
  };
}
