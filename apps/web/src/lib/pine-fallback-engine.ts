import type {
  ExecutionHandlers,
  ExecutionRequest,
  ExecutionSession,
  PreparedScript,
  ScriptingEngine,
  VisibleBarRange,
} from "@luxalgo/vela";

/**
 * Pine scripts run in a Web Worker so heavy ones never block drawing. Browsers give a worker
 * far less stack than the page (Chrome: about a third), and PineTS compiles scripts with a
 * recursive syntax-tree walk, so a script with a very long expression or condition chain can
 * fail there with "Maximum call stack size exceeded" while it compiles fine on the page. This
 * engine keeps every script in the worker and moves only those onto the page's own thread.
 */

export const isStackOverflow = (error: unknown) =>
  /maximum call stack size exceeded|too much recursion/i.test(
    error instanceof Error ? error.message : String(error),
  );

export const TOO_DEEP_MESSAGE =
  "This script nests too deeply for the Pine engine (usually a very long expression or chain of conditions). Split long expressions into intermediate variables and run it again.";

/** A stack overflow explained; any other error as it was. */
export const explainEngineError = (error: unknown): Error =>
  isStackOverflow(error)
    ? new Error(TOO_DEEP_MESSAGE)
    : error instanceof Error
      ? error
      : new Error(String(error));

type Values = Parameters<ExecutionSession["update"]>[0];

/** Sources remembered as too deep for the worker, so reopening a chart skips the failed try. */
const MAX_REMEMBERED = 50;

export class FallbackPineEngine implements ScriptingEngine {
  readonly language = "pine";
  readonly capabilities: ScriptingEngine["capabilities"];
  private main: ScriptingEngine | null = null;
  /** Prepared scripts that belong to the page-thread engine. */
  private readonly onMain = new WeakSet<PreparedScript>();
  /** What each worker-prepared script was made from, to prepare it again on the page. */
  private readonly origins = new WeakMap<PreparedScript, { source: string; id: string }>();
  private readonly tooDeep = new Set<string>();

  constructor(
    private readonly worker: ScriptingEngine & { terminate?: () => void },
    /** Made on first need: most charts never use it. */
    private readonly createMain: () => ScriptingEngine,
  ) {
    this.capabilities = worker.capabilities;
  }

  /** Ends the worker (the chart is closing). */
  terminate() {
    this.worker.terminate?.();
  }

  private page(): ScriptingEngine {
    this.main ??= this.createMain();
    return this.main;
  }

  private remember(source: string) {
    this.tooDeep.add(source);
    if (this.tooDeep.size > MAX_REMEMBERED)
      this.tooDeep.delete(this.tooDeep.values().next().value!);
  }

  private async prepareOnPage(source: string, id: string): Promise<PreparedScript> {
    this.remember(source);
    try {
      const prepared = await this.page().prepare(source, id);
      this.onMain.add(prepared);
      return prepared;
    } catch (error) {
      throw explainEngineError(error);
    }
  }

  async prepare(source: string, id: string): Promise<PreparedScript> {
    if (this.tooDeep.has(source)) return this.prepareOnPage(source, id);
    try {
      const prepared = await this.worker.prepare(source, id);
      this.origins.set(prepared, { source, id });
      return prepared;
    } catch (error) {
      if (!isStackOverflow(error)) throw error;
      return this.prepareOnPage(source, id);
    }
  }

  execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
    if (this.onMain.has(req.prepared)) return this.page().execute(req, explained(handlers));
    return new MovableSession(req, handlers, this.worker, async () => {
      const origin = this.origins.get(req.prepared);
      if (!origin) return null;
      const prepared = await this.prepareOnPage(origin.source, origin.id);
      return { engine: this.page(), prepared };
    });
  }
}

/** Handlers that explain a stack overflow instead of passing on the bare message. */
const explained = (handlers: ExecutionHandlers): ExecutionHandlers => ({
  ...handlers,
  onError: (error) => handlers.onError?.(explainEngineError(error)),
});

/**
 * A worker run that moves to the page thread if the script overflows the worker's stack
 * while compiling or running. Calls made meanwhile (new inputs, viewport) carry over.
 */
class MovableSession implements ExecutionSession {
  private current: ExecutionSession;
  private moved = false;
  private stopped = false;
  private inputs: Values | undefined;
  private props: Values | undefined;
  private range: VisibleBarRange | undefined;

  constructor(
    private readonly req: ExecutionRequest,
    private readonly handlers: ExecutionHandlers,
    worker: ScriptingEngine,
    private readonly toPage: () => Promise<{
      engine: ScriptingEngine;
      prepared: PreparedScript;
    } | null>,
  ) {
    this.inputs = req.inputs;
    this.props = req.props;
    this.range = req.visibleRange;
    this.current = worker.execute(req, {
      ...handlers,
      onModel: (model) => !this.moved && handlers.onModel(model),
      onAlert: (alert) => !this.moved && handlers.onAlert?.(alert),
      onWarning: (warning) => !this.moved && handlers.onWarning?.(warning),
      onDone: () => !this.moved && handlers.onDone?.(),
      onError: (error) => {
        if (this.moved) return;
        if (isStackOverflow(error)) void this.move(error);
        else handlers.onError?.(error);
      },
    });
  }

  private async move(original: unknown) {
    this.moved = true;
    this.current.stop();
    try {
      const target = await this.toPage();
      if (!target) throw original;
      if (this.stopped) return;
      this.current = target.engine.execute(
        {
          ...this.req,
          prepared: target.prepared,
          bars: this.req.getBars?.() ?? this.req.bars,
          inputs: this.inputs,
          props: this.props,
          visibleRange: this.range,
        },
        explained(this.handlers),
      );
    } catch (error) {
      if (!this.stopped) this.handlers.onError?.(explainEngineError(error));
    }
  }

  getContext: ExecutionSession["getContext"] = (select) =>
    this.current.getContext?.(select) ?? Promise.resolve(null);

  stop() {
    this.stopped = true;
    this.current.stop();
  }

  update(inputs: Values, props?: Values) {
    this.inputs = { ...this.inputs, ...inputs };
    if (props) this.props = { ...this.props, ...props };
    this.current.update(inputs, props);
  }

  setVisibleRange(range: VisibleBarRange) {
    this.range = range;
    this.current.setVisibleRange(range);
  }

  notifyBars(reason?: Parameters<ExecutionSession["notifyBars"]>[0]) {
    this.current.notifyBars(reason);
  }
}
