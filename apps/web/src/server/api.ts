import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE, passwordConfigured, verifySession } from "./auth";

export const ok = (data: unknown, init?: ResponseInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
};

export const bad = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

/**
 * Route-handler wrapper: uniform error JSON instead of HTML 500 pages, and the
 * data gate for optional password auth. The middleware only checks that a
 * session cookie is present (its runtime has no Node crypto); the signature is
 * verified here, on every route except those marked `public` (login).
 */
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
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
