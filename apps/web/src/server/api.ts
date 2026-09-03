import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, passwordConfigured, verifySession } from "./auth";

export class RequestError extends Error {}
export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RequestError(message);
}

export const ok = (data: unknown, init?: ResponseInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
};

export const bad = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

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
        if (!verifySession(token)) return bad("Unauthorized", 401);
      }
      return await fn(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      return NextResponse.json(
        { error: message },
        { status: error instanceof RequestError ? 400 : 500 },
      );
    }
  };
