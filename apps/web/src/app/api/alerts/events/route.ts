import { handler, ok } from "@/server/api";
import { recentAlertEvents } from "@/server/background-alerts/engine";

/** Alerts the server raised (for one analysis with `?analysisId=`). */
export const GET = handler((request: Request) => {
  const id = new URL(request.url).searchParams.get("analysisId");
  return ok({ events: recentAlertEvents(id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null) });
});
