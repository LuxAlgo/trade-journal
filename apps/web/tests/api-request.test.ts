import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireJson } from "../src/lib/api-request";

afterEach(() => vi.unstubAllGlobals());

describe("concurrent journal reads", () => {
  it("shares a pending read and fetches fresh data after it completes", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const a = acquireJson<{ version: number }>("/settings");
    const b = acquireJson<{ version: number }>("/settings");
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(Response.json({ version: 1 }));
    expect(await a.promise).toEqual({ version: 1 });
    expect(await b.promise).toEqual({ version: 1 });
    a.release();
    b.release();
    const fresh = acquireJson<{ version: number }>("/settings");
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolve(Response.json({ version: 2 }));
    expect(await fresh.promise).toEqual({ version: 2 });
    fresh.release();
  });

  it("only cancels when the final consumer leaves", async () => {
    let signal!: AbortSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) => {
        signal = options.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
        );
      }),
    );
    const a = acquireJson("/trades");
    const b = acquireJson("/trades");
    const result = a.promise.catch((e) => e.name);
    a.release();
    await Promise.resolve();
    expect(signal.aborted).toBe(false);
    b.release();
    await Promise.resolve();
    expect(signal.aborted).toBe(true);
    expect(await result).toBe("AbortError");
  });

  it("allows a failed request to be retried", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }))
        .mockResolvedValueOnce(Response.json({ saved: true })),
    );
    const failed = acquireJson("/retry");
    await expect(failed.promise).rejects.toThrow("Unavailable");
    failed.release();
    const retry = acquireJson("/retry");
    await expect(retry.promise).resolves.toEqual({ saved: true });
    retry.release();
  });
});
