/**
 * Runs once when the server starts: begin watching background alerts. Set
 * JOURNAL_BACKGROUND_ALERTS=off to never start the watcher.
 */
export async function register() {
  // The literal check lets the Edge build drop the Node-only watcher entirely.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundWork } = await import("./instrumentation-node");
    startBackgroundWork();
  }
}
