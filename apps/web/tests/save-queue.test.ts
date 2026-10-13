import { describe, expect, it } from "vitest";
import { queueFlush, type SaveState } from "../src/lib/save-queue";

type Options = { final?: boolean };
type Result = { ok: boolean; saved: string };

/** A save whose requests finish when the test says; records what each one saved. */
function server() {
  let edits = "a";
  const saves: { saved: string; final: boolean; finish: (ok: boolean) => void }[] = [];
  const saveOnce = (options: Options) =>
    new Promise<Result>((resolve) => {
      const saved = edits;
      saves.push({
        saved,
        final: Boolean(options.final),
        finish: (ok) => resolve({ ok, saved }),
      });
    });
  return {
    saves,
    saveOnce,
    edit: (text: string) => {
      edits = text;
    },
  };
}

const merge = (a: Options, b: Options): Options => ({ final: a.final || b.final });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("autosave never reports a save that has not happened", () => {
  it("a flush asked for during a save waits for the save that includes its edits", async () => {
    const state: SaveState<Options, Result> = { running: null, again: null };
    const api = server();
    const first = queueFlush(state, {}, api.saveOnce, merge);
    api.edit("ab");
    let settled = false;
    const second = queueFlush(state, { final: true }, api.saveOnce, merge).then((r) => {
      settled = true;
      return r;
    });
    api.saves[0]!.finish(true);
    await tick();
    // The follow-up save is running: the second caller has not returned yet.
    expect(api.saves).toHaveLength(2);
    expect(api.saves[1]).toMatchObject({ saved: "ab", final: true });
    expect(settled).toBe(false);
    api.saves[1]!.finish(true);
    expect(await second).toEqual({ ok: true, saved: "ab" });
    expect(await first).toEqual({ ok: true, saved: "ab" });
    expect(state.running).toBeNull();
  });

  it("several flushes during one save join into a single follow-up", async () => {
    const state: SaveState<Options, Result> = { running: null, again: null };
    const api = server();
    void queueFlush(state, {}, api.saveOnce, merge);
    void queueFlush(state, {}, api.saveOnce, merge);
    const last = queueFlush(state, { final: true }, api.saveOnce, merge);
    api.saves[0]!.finish(true);
    await tick();
    api.saves[1]!.finish(true);
    await last;
    expect(api.saves.map((s) => s.final)).toEqual([false, true]);
  });

  it("a failed save ends the flush and every waiting caller learns it failed", async () => {
    const state: SaveState<Options, Result> = { running: null, again: null };
    const api = server();
    const first = queueFlush(state, {}, api.saveOnce, merge);
    const joined = queueFlush(state, { final: true }, api.saveOnce, merge);
    api.saves[0]!.finish(false);
    expect((await first).ok).toBe(false);
    expect((await joined).ok).toBe(false);
    expect(api.saves).toHaveLength(1);
    expect(state).toEqual({ running: null, again: null });
  });

  it("a flush after the last one settled starts a new save", async () => {
    const state: SaveState<Options, Result> = { running: null, again: null };
    const api = server();
    const first = queueFlush(state, {}, api.saveOnce, merge);
    api.saves[0]!.finish(true);
    await first;
    const next = queueFlush(state, {}, api.saveOnce, merge);
    expect(api.saves).toHaveLength(2);
    api.saves[1]!.finish(true);
    expect((await next).ok).toBe(true);
  });
});
