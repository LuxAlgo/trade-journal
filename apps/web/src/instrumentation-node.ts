import { startAlertEngine } from "./server/background-alerts/engine";

/** Node-only startup work (imported by instrumentation.ts on the Node runtime). */
export function startBackgroundWork() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.JOURNAL_BACKGROUND_ALERTS === "off") return;
  startAlertEngine();
}
