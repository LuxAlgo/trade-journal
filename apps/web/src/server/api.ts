import { NextResponse } from "next/server";

export const ok = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

export const bad = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

/** Route-handler wrapper: uniform error JSON instead of HTML 500 pages. */
export const handler =
  <A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) =>
  async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
