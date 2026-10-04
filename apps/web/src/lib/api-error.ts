/**
 * Client-side carrier for the API's error contract: `{ error, code?, params? }`.
 * The `error` text stays the machine-stable English identifier (existing
 * consumers, including lib/ai-feedback.ts, match on it); `code` names a key in
 * the `errors` message namespace so the UI can localize, and `params` feeds
 * that message's ICU placeholders.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
  }
}

/**
 * Plain-object error shape accepted by formatApiError: the raw message plus
 * the optional stable code/params. `lib/use-api.ts` exposes GET failures as
 * this shape (errorInfo) so callers localize without re-deriving anything.
 */
export interface ApiErrorInfo {
  message: string;
  code?: string;
  params?: Record<string, string | number>;
}

/**
 * Minimal translator shape used here: next-intl's `t` (which also carries
 * `has`) or any compatible stand-in in tests. `has` is optional so plain
 * dictionary mocks work; without it, a rendered key-shaped string falls back.
 */
export type ErrorTranslator = {
  (key: string, params?: Record<string, string | number>): string;
  has?: (key: string) => boolean;
};

/**
 * Localize an API error by its stable code via the `errors` namespace. Accepts
 * an `ApiError`, a plain `{ message, code?, params? }` shape, or a bare string
 * (returned as-is). Falls back to the original message when there is no code
 * or no catalog entry — the fallback never masks or re-translates the server's
 * text (i18n.md §6).
 */
export function formatApiError(t: ErrorTranslator, error: unknown): string {
  if (typeof error === "string") return error;
  let message: string;
  let code: string | undefined;
  let params: Record<string, string | number> | undefined;
  if (error instanceof ApiError) {
    message = error.message;
    code = error.code;
    params = error.params;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const shaped = error as ApiErrorInfo;
    message = shaped.message;
    code = shaped.code;
    params = shaped.params;
  } else {
    return String(error);
  }
  if (!code) return message;
  const key = `errors.${code}`;
  if (t.has && !t.has(key)) return message;
  const text = t(key, params);
  return text === key ? message : text;
}
