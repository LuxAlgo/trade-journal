import type { IndicatorHandle, Vela } from "@luxalgo/vela";
import { declaredTitle, type IndicatorRef, type StoredIndicator } from "@/lib/chart-indicators";

/** An indicator on the chart as the panel shows it: what is saved, plus its last error. */
export interface ChartIndicator extends StoredIndicator {
  error?: string;
}

export interface IndicatorAlert {
  indicator: string;
  message: string;
  time: number;
}

export type RunResult = { ok: true; id: string } | { ok: false; error: string };

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "Script error.";

let counter = 0;
const indicatorId = () => `ind-${Date.now().toString(36)}${(counter += 1).toString(36)}`;

/**
 * The chart's script indicators, kept in step with what is saved: where each one's code
 * came from, the input and property edits made in Vela's settings dialog, visibility and
 * errors. Native indicators (Vela's volume) are Vela's own and are not saved.
 */
export function createIndicatorBridge(
  instance: Vela,
  hooks: {
    onChange: (indicators: ChartIndicator[], edited: boolean) => void;
    onAlert: (alert: IndicatorAlert) => void;
  },
) {
  const refs = new Map<string, IndicatorRef>();
  /** Unsubscribers for each indicator's `ready` (compiled: real title and inputs known). */
  const readiness = new Map<string, () => void>();
  const errors = new Map<string, string>();
  let restoring = false;

  const scriptHandles = () => instance.indicators().filter((h) => h.source !== undefined);
  const snapshot = (): ChartIndicator[] =>
    scriptHandles().map((h: IndicatorHandle) => ({
      id: h.id,
      ref: refs.get(h.id) ?? { kind: "inline" },
      // Until compiled, Vela shows a placeholder; the source already declares the title.
      title: h.title && h.title !== "Indicator" ? h.title : (declaredTitle(h.source!) ?? h.title),
      source: h.source!,
      inputs: { ...h.inputValues() },
      props: { ...h.propValues() },
      visible: h.visible,
      ...(errors.has(h.id) ? { error: errors.get(h.id) } : {}),
    }));
  const publish = (edited: boolean) => {
    if (!restoring) hooks.onChange(snapshot(), edited);
  };

  const watch = (id: string) => {
    const handle = instance.indicators().find((h) => h.id === id);
    if (!handle || readiness.has(id)) return;
    readiness.set(
      id,
      handle.on("ready", () => {
        errors.delete(id);
        publish(false);
      }),
    );
  };
  const offs = [
    instance.on("indicator:added", ({ id }) => {
      watch(id);
      publish(true);
    }),
    instance.on("indicator:removed", ({ id }) => {
      refs.delete(id);
      errors.delete(id);
      readiness.get(id)?.();
      readiness.delete(id);
      publish(true);
    }),
    instance.on("indicator:inputs", ({ id }) => {
      errors.delete(id);
      publish(true);
    }),
    instance.on("indicator:visibility", () => publish(true)),
    instance.on("indicator:moved", () => publish(true)),
    instance.on("indicator:error", ({ id, error }) => {
      errors.set(id, errorText(error));
      publish(false);
    }),
    instance.on("alert", (alert) =>
      hooks.onAlert({
        indicator: alert.indicator ?? "Indicator",
        message: alert.message,
        time: alert.time,
      }),
    ),
  ];

  const find = (id: string) => instance.indicators().find((h) => h.id === id);

  return {
    /** Put saved indicators back, with their settings; runtime errors arrive as events. */
    restore(saved: StoredIndicator[]) {
      restoring = true;
      try {
        for (const item of saved) {
          try {
            refs.set(item.id, item.ref);
            const handle = instance.addIndicator(item.source, {
              id: item.id,
              inputs: item.inputs,
              props: item.props,
            });
            if (!item.visible) handle.setVisible(false);
            watch(handle.id);
          } catch (error) {
            errors.set(item.id, errorText(error));
          }
        }
      } finally {
        restoring = false;
      }
      publish(false);
    },
    /** Run new code on the chart; it only stays if it compiles and runs. */
    async add(ref: IndicatorRef, source: string): Promise<RunResult> {
      const id = indicatorId();
      refs.set(id, ref);
      const result = await instance.runIndicator(source, { id });
      if (!result.ok || !result.handle) {
        refs.delete(id);
        return { ok: false, error: errorText(result.error) };
      }
      publish(true);
      return { ok: true, id };
    },
    /**
     * Swap an indicator's code, keeping its inputs where they still exist. The old one
     * stays on the chart until the new code runs, so a mistake never loses it.
     */
    async replace(id: string, ref: IndicatorRef, source: string): Promise<RunResult> {
      const current = find(id);
      if (!current) return this.add(ref, source);
      const next = indicatorId();
      refs.set(next, ref);
      const result = await instance.runIndicator(source, {
        id: next,
        inputs: current.inputValues(),
        props: current.propValues(),
      });
      if (!result.ok || !result.handle) {
        refs.delete(next);
        return { ok: false, error: errorText(result.error) };
      }
      if (!current.visible) result.handle.setVisible(false);
      current.remove();
      publish(true);
      return { ok: true, id: next };
    },
    /** Point indicators at another source (a script saved from the editor). */
    relink(id: string, ref: IndicatorRef) {
      if (!find(id)) return;
      refs.set(id, ref);
      publish(true);
    },
    remove(id: string) {
      find(id)?.remove();
    },
    setVisible(id: string, visible: boolean) {
      find(id)?.setVisible(visible);
    },
    openSettings(id: string) {
      if (instance.renderer.supportsIndicatorSettings) instance.renderer.openIndicatorSettings(id);
    },
    list: snapshot,
    dispose() {
      offs.forEach((off) => off());
      readiness.forEach((off) => off());
      readiness.clear();
    },
  };
}

export type IndicatorBridge = ReturnType<typeof createIndicatorBridge>;
