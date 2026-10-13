import { describe, expect, it, vi } from "vitest";
import type { Vela } from "@luxalgo/vela";
import { createIndicatorBridge } from "../src/components/chart-indicators-bridge";
import type { StoredIndicator } from "../src/lib/chart-indicators";

/** Enough of a Vela chart for the bridge: handles, events, and an add that can fail. */
function fakeChart() {
  const handles: {
    id: string;
    source: string;
    title: string;
    visible: boolean;
    inputValues: () => Record<string, unknown>;
    propValues: () => Record<string, unknown>;
    setVisible: (v: boolean) => void;
    on: () => () => void;
    remove: () => void;
  }[] = [];
  const instance = {
    indicators: () => handles,
    on: () => () => {},
    addIndicator: (source: string, options: { id: string }) => {
      if (source.includes("broken")) throw new Error("Syntax error on line 2");
      const handle = {
        id: options.id,
        source,
        title: "Indicator",
        visible: true,
        inputValues: () => ({}),
        propValues: () => ({}),
        setVisible(v: boolean) {
          handle.visible = v;
        },
        on: () => () => {},
        remove: () => handles.splice(handles.indexOf(handle), 1),
      };
      handles.push(handle);
      return handle;
    },
  };
  return instance as unknown as Vela;
}

const stored = (id: string, source: string): StoredIndicator => ({
  id,
  ref: { kind: "inline" },
  title: id,
  source,
  inputs: { length: 20 },
  props: {},
  visible: true,
});

describe("saved indicators survive a chart that cannot add them back", () => {
  const ok = stored("ind-ok", '//@version=5\nindicator("Fine")\nplot(close)');
  const broken = stored("ind-bad", '//@version=5\nindicator("broken")\nplot(');

  it("an indicator that fails to restore stays in what is saved, with its error", () => {
    const onChange = vi.fn();
    const bridge = createIndicatorBridge(fakeChart(), { onChange, onAlert: () => {} });
    bridge.restore([ok, broken]);
    const saved = onChange.mock.calls.at(-1)![0] as { id: string; error?: string }[];
    expect(saved.map((i) => i.id)).toEqual(["ind-ok", "ind-bad"]);
    expect(saved[1]).toMatchObject({ source: broken.source, inputs: { length: 20 } });
    expect(saved[1]!.error).toContain("Syntax error");
    expect(bridge.list().map((i) => i.id)).toEqual(["ind-ok", "ind-bad"]);
  });

  it("it leaves only when you remove it, and can be hidden meanwhile", () => {
    const onChange = vi.fn();
    const bridge = createIndicatorBridge(fakeChart(), { onChange, onAlert: () => {} });
    bridge.restore([broken]);
    bridge.setVisible("ind-bad", false);
    expect(bridge.list()[0]!.visible).toBe(false);
    bridge.remove("ind-bad");
    expect(bridge.list()).toEqual([]);
    expect(onChange.mock.calls.at(-1)![1]).toBe(true);
  });

  it("fixing its code puts the working indicator in its place", async () => {
    const chart = fakeChart();
    (chart as unknown as { runIndicator: unknown }).runIndicator = async (
      source: string,
      options: { id: string },
    ) => ({ ok: true, handle: chart.addIndicator(source, options) });
    const bridge = createIndicatorBridge(chart, { onChange: () => {}, onAlert: () => {} });
    bridge.restore([broken]);
    const result = await bridge.replace("ind-bad", { kind: "inline" }, ok.source);
    expect(result.ok).toBe(true);
    expect(bridge.list()).toHaveLength(1);
    expect(bridge.list()[0]!.error).toBeUndefined();
  });
});
