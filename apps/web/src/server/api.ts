import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, passwordConfigured, verifySession } from "./auth";

/** Interpolation values for a localized error message, keyed by ICU parameter name. */
export type ApiErrorParams = Record<string, string | number>;

/**
 * Error carrying a stable machine `code` next to the human message. The
 * `{error}` text stays the machine-stable identifier (existing consumers,
 * including lib/ai-feedback.ts, match on it); `code` only adds a localization
 * key. Status semantics are decided by the thrown class, unchanged.
 */
export class CodedError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly params?: ApiErrorParams,
  ) {
    super(message);
  }
}

export class RequestError extends CodedError {}

export function requireValue(
  condition: unknown,
  message: string,
  code?: string,
  params?: ApiErrorParams,
): asserts condition {
  if (!condition) throw new RequestError(message, code, params);
}

export const ok = (data: unknown, init?: ResponseInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
};

export const bad = (message: string, status = 400, code?: string, params?: ApiErrorParams) => {
  const body: { error: string; code?: string; params?: ApiErrorParams } = { error: message };
  if (code) body.code = code;
  if (params) body.params = params;
  return NextResponse.json(body, { status });
};

/** Route-handler wrapper: uniform error JSON instead of HTML 500 pages. */
export const handler =
  <A extends unknown[]>(
    fn: (...args: A) => Promise<Response> | Response,
    options: { public?: boolean } = {},
  ) =>
  async (...args: A): Promise<Response> => {
    try {
      if (!options.public && passwordConfigured()) {
        const token = (await cookies()).get(AUTH_COOKIE)?.value;
        if (!verifySession(token)) return bad("Unauthorized", 401, "unauthorized");
      }
      return await fn(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      // Third-party/unknown failures get a stable generic code; the sanitized
      // message keeps the existing safety boundary (never a provider payload).
      // A coded error without a code keeps the message-only contract.
      let code: string | undefined;
      let params: ApiErrorParams | undefined;
      if (error instanceof CodedError) {
        code = error.code;
        params = error.params;
      } else {
        code = "internal_error";
      }
      return NextResponse.json(
        { error: message, ...(code ? { code } : {}), ...(params ? { params } : {}) },
        { status: error instanceof RequestError ? 400 : 500 },
      );
    }
  };
