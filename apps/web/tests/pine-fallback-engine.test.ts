import { describe, expect, it, vi } from "vitest";
import type {
  ExecutionHandlers,
  ExecutionRequest,
  PreparedScript,
  ScriptingEngine,
} from "@luxalgo/vela";
import { FallbackPineEngine, TOO_DEEP_MESSAGE } from "../src/lib/pine-fallback-engine";

const overflow = () => new RangeError("Maximum call stack size exceeded");

/** A fake engine: `fails` decides whether a source overflows when preparing or running. */
function fakeEngine(name: string, fails: { prepare?: RegExp; run?: RegExp } = {}) {
  const sessions: {
    source: string;
    inputs: Record<string, unknown> | undefined;
    stopped: boolean;
  }[] = [];
  const engine = {
    language: "pine",
    capabilities: { streaming: true, visibleRange: true, inputs: true, props: true },
    prepare: vi.fn(async (source: string) => {
      if (fails.prepare?.test(source)) throw overflow();
      return {
        language: "pine",
        inputs: [],
        meta: { name },
        reactsToViewport: false,
        token: source,
      } as unknown as PreparedScript;
    }),
    execute: vi.fn((req: ExecutionRequest, handlers: ExecutionHandlers) => {
      const source = req.prepared.token as string;
      const session: (typeof sessions)[number] = { source, inputs: req.inputs, stopped: false };
      sessions.push(session);
      queueMicrotask(() => {
        if (fails.run?.test(source)) handlers.onError?.(overflow());
        else handlers.onModel({ from: name } as never);
      });
      return {
        stop: () => void (session.stopped = true),
        update: (inputs: Record<string, unknown>) =>
          void (session.inputs = { ...session.inputs, ...inputs }),
        setVisibleRange: () => {},
        notifyBars: () => {},
      };
    }),
  };
  return { engine: engine as unknown as ScriptingEngine, sessions, spy: engine };
}

const run = async (engine: FallbackPineEngine, source: string, inputs = {}) => {
  const prepared = await engine.prepare(source, "ind-1");
  const models: unknown[] = [];
  const errors: string[] = [];
  const session = engine.execute(
    { prepared, bars: [], mode: "static", inputs } as unknown as ExecutionRequest,
    {
      onModel: (model) => models.push(model),
      onError: (error) => errors.push(error.message),
    },
  );
  return { session, models, errors };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("scripts too deep for the worker run on the page instead", () => {
  it("an ordinary script stays in the worker, and the page engine is never made", async () => {
    const worker = fakeEngine("worker");
    const makePage = vi.fn(() => fakeEngine("page").engine);
    const { models } = await run(new FallbackPineEngine(worker.engine, makePage), "plot(close)");
    await settle();
    expect(models).toEqual([{ from: "worker" }]);
    expect(makePage).not.toHaveBeenCalled();
  });

  it("a script that overflows the worker while compiling runs on the page", async () => {
    const worker = fakeEngine("worker", { prepare: /deep/ });
    const page = fakeEngine("page");
    const engine = new FallbackPineEngine(worker.engine, () => page.engine);
    const { models, errors } = await run(engine, "deep script");
    await settle();
    expect(models).toEqual([{ from: "page" }]);
    expect(errors).toEqual([]);
    // Remembered: the next chart that opens it skips the worker.
    await run(engine, "deep script");
    expect(worker.spy.prepare).toHaveBeenCalledTimes(1);
  });

  it("a script that overflows the worker while running moves to the page with its latest inputs", async () => {
    const worker = fakeEngine("worker", { run: /deep/ });
    const page = fakeEngine("page");
    const { session, models, errors } = await run(
      new FallbackPineEngine(worker.engine, () => page.engine),
      "deep script",
      { Length: 14 },
    );
    session.update({ Length: 21 });
    await settle();
    await settle();
    expect(worker.sessions[0]!.stopped).toBe(true);
    expect(page.sessions[0]!.inputs).toEqual({ Length: 21 });
    expect(models).toEqual([{ from: "page" }]);
    expect(errors).toEqual([]);
  });

  it("a script too deep even for the page says how to fix it", async () => {
    const engine = new FallbackPineEngine(
      fakeEngine("worker", { prepare: /deep/ }).engine,
      () => fakeEngine("page", { prepare: /deep/ }).engine,
    );
    await expect(engine.prepare("deep script", "ind-1")).rejects.toThrow(TOO_DEEP_MESSAGE);
  });

  it("other script errors pass through unchanged", async () => {
    const worker = fakeEngine("worker");
    worker.spy.prepare.mockRejectedValueOnce(new Error("line 3: undeclared identifier 'foo'"));
    const engine = new FallbackPineEngine(worker.engine, () => fakeEngine("page").engine);
    await expect(engine.prepare("plot(foo)", "ind-1")).rejects.toThrow("undeclared identifier");
  });
});
