"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, formatApiError, type ApiErrorInfo, type ErrorTranslator } from "./api-error";

/** Stable autosave phase for UI rendering; `status` keeps the legacy raw string. */
export interface AutosaveState {
  state: "idle" | "saving" | "saved" | "error";
  /** Raw failure text when state is "error" (empty otherwise) — the English fallback. */
  message: string;
  /** Failure carrying the stable code/params for formatApiError; null when uncoded. */
  errorInfo: ApiErrorInfo | null;
}

const IDLE: AutosaveState = { state: "idle", message: "", errorInfo: null };

/**
 * Localized autosave status text via the `controls` namespace; a failed save
 * localizes its cause through `errors.<code>` when available (i18n.md §6) and
 * falls back to the raw English message otherwise.
 */
export function formatAutosaveStatus(
  tControls: ErrorTranslator,
  tErrors: ErrorTranslator,
  saveState: AutosaveState | undefined,
  fallback: string,
): string {
  if (!saveState || saveState.state === "idle") return fallback;
  if (saveState.state === "error") {
    const detail = saveState.errorInfo
      ? formatApiError(tErrors, saveState.errorInfo)
      : saveState.message;
    return tControls("autosave.notSaved", { message: detail });
  }
  return saveState.state === "saving" ? tControls("autosave.saving") : tControls("autosave.saved");
}

/** Merge rapid edits and send one request at a time. Failed writes retain the latest fields for retry. */
export function useAutosave(url: string, method: "PATCH" | "PUT" = "PATCH", onSaved?: () => void) {
  const [status, setStatus] = useState("");
  const [saveState, setSaveState] = useState<AutosaveState>(IDLE);
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
          const result = (await response.json()) as {
            error?: string;
            code?: string;
            params?: Record<string, string | number>;
          };
          if (!response.ok)
            throw new ApiError(result.error ?? "Save failed", result.code, result.params);
          if (mounted.current) {
            const more = Object.keys(pending.current).length > 0;
            setStatus(more ? "Saving…" : "Saved");
            setSaveState(
              more
                ? { state: "saving", message: "", errorInfo: null }
                : { state: "saved", message: "", errorInfo: null },
            );
            callback.current?.();
          }
        } catch (e) {
          pending.current = { ...body, ...pending.current };
          if (mounted.current) {
            const info: ApiErrorInfo =
              e instanceof ApiError
                ? { message: e.message, code: e.code, params: e.params }
                : e instanceof Error
                  ? { message: e.message }
                  : { message: "Connection failed" };
            setStatus(`Not saved: ${info.message}`);
            setSaveState({ state: "error", message: info.message, errorInfo: info });
          }
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
      setSaveState({ state: "saving", message: "", errorInfo: null });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 500);
    },
    [flush],
  );
  return { save, status, saveState, flush };
}
