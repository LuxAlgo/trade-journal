"use client";
import { useCallback, useEffect, useRef, useState } from "react";
/** Merge rapid edits and send one request at a time. Failed writes retain the latest fields for retry. */
export function useAutosave(url: string, method: "PATCH" | "PUT" = "PATCH", onSaved?: () => void) {
  const [status, setStatus] = useState("");
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const callback = useRef(onSaved);
  callback.current = onSaved;
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (running.current) return running.current;
    const work = async () => {
      while (Object.keys(pending.current).length) {
        const body = pending.current;
        pending.current = {};
        try {
          const response = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            keepalive: JSON.stringify(body).length < 50000,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Save failed");
          if (mounted.current) {
            setStatus(Object.keys(pending.current).length ? "Saving…" : "Saved");
            callback.current?.();
          }
        } catch (e) {
          pending.current = { ...body, ...pending.current };
          if (mounted.current)
            setStatus(`Not saved: ${e instanceof Error ? e.message : "Connection failed"}`);
          break;
        }
      }
    };
    running.current = work().finally(() => {
      running.current = null;
    });
    return running.current;
  }, [url, method]);
  useEffect(() => {
    mounted.current = true;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length || running.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", beforeUnload);
      void flush();
    };
  }, [flush]);
  const save = useCallback(
    (body: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...body };
      setStatus("Saving…");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 500);
    },
    [flush],
  );
  return { save, status, flush };
}
