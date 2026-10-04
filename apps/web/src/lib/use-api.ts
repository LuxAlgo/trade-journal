"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { acquireJson } from "./api-request";
import { ApiError, type ApiErrorInfo } from "./api-error";

export interface ApiState<T> {
  data: T | null;
  /** Raw English failure text (unchanged contract; server text stays the identifier). */
  error: string | null;
  /**
   * Same failure carrying the stable code/params for `formatApiError` —
   * null when the failure had no code (network errors and uncoded server
   * errors keep falling back to the English text).
   */
  errorInfo: ApiErrorInfo | null;
  loading: boolean;
  refresh: () => void;
}

const errorStateOf = (cause: unknown): ApiErrorInfo =>
  cause instanceof Error
    ? {
        message: cause.message,
        ...(cause instanceof ApiError ? { code: cause.code, params: cause.params } : {}),
      }
    : { message: "Network error" };

/** Deduplicate concurrent reads and cancel requests when their last consumer leaves. */
export const useApi = <T>(url: string | null): ApiState<T> => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorInfo, setErrorInfo] = useState<ApiErrorInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const [tick, setTick] = useState(0);
  const [dataUrl, setDataUrl] = useState(url);

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      setErrorInfo(null);
      setLoading(false);
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setErrorInfo(null);
    const request = acquireJson<T>(url);
    request.promise
      .then((body) => {
        if (cancelled) return;
        // Render fresh data as a transition so React yields to the browser mid-render
        // instead of blocking the main thread for the whole page.
        startTransition(() => {
          setData(body);
          setDataUrl(url);
          setError(null);
          setErrorInfo(null);
          setLoading(false);
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          const state = errorStateOf(cause);
          setErrorInfo(state);
          setError(state.message);
          setData(null);
          setDataUrl(url);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      request.release();
    };
  }, [url, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const current = dataUrl === url;
  return {
    data: current ? data : null,
    error: current ? error : null,
    errorInfo: current ? errorInfo : null,
    loading: Boolean(url) && (!current || loading),
    refresh,
  };
};

export const postJson = async <T = unknown>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST",
): Promise<T> => {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as T & {
    error?: string;
    code?: string;
    params?: Record<string, string | number>;
  };
  if (!response.ok)
    throw new ApiError(data.error ?? `Request failed (${response.status})`, data.code, data.params);
  return data;
};
