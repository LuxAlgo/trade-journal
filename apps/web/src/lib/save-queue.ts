/**
 * One save at a time, and no caller left behind: a flush asked for while one runs joins it,
 * and the running flush saves once more (with the joined options) before it settles, so
 * every caller's promise resolves only after a save that includes its edits. A failed save
 * ends the flush; its result says so.
 */

export interface SaveState<O, R> {
  /** The flush in progress, follow-up saves included. */
  running: Promise<R> | null;
  /** Options of the flushes that joined the running one, merged. */
  again: O | null;
}

export function queueFlush<O extends object, R extends { ok: boolean }>(
  state: SaveState<O, R>,
  options: O,
  saveOnce: (options: O) => Promise<R>,
  merge: (a: O, b: O) => O,
): Promise<R> {
  if (state.running) {
    state.again = state.again ? merge(state.again, options) : options;
    return state.running;
  }
  const run = async () => {
    let result = await saveOnce(options);
    while (result.ok && state.again) {
      const next = state.again;
      state.again = null;
      result = await saveOnce(next);
    }
    return result;
  };
  const whole: Promise<R> = run().finally(() => {
    state.again = null;
    if (state.running === whole) state.running = null;
  });
  state.running = whole;
  return whole;
}
