"use client";

import { useSyncExternalStore } from "react";
import type { LatestBar, LiveStatus } from "./live-market";

/**
 * A chart's latest price and feed status. They change up to a few times a second while
 * streaming, so they live outside React state: only the small pieces that show them (the
 * price line, the live badge) re-render, not the whole chart page.
 */
export interface LiveView {
  status: LiveStatus;
  latest: LatestBar | null;
}

export function createLiveStore() {
  let view: LiveView = { status: { state: "idle" }, latest: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<LiveView>) => {
    view = { ...view, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    get: () => view,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setStatus: (status: LiveStatus) => set({ status }),
    setLatest: (latest: LatestBar | null) => set({ latest }),
  };
}

export type LiveStore = ReturnType<typeof createLiveStore>;

/** The store's current view; re-renders the caller when it changes. */
export const useLiveView = (store: LiveStore): LiveView =>
  useSyncExternalStore(store.subscribe, store.get, store.get);
