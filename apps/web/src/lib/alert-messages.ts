import { fmtNumber } from "./utils";
import type { LineCrossing } from "./price-alerts";
import type { SrZone, ZoneEvent } from "./sr-zones";

/**
 * Alert wording shared by the open chart and the server's background watcher, so a push
 * notification reads the same as the in-page alert. The tag lets a device replace one
 * notification with the next for the same line instead of stacking duplicates.
 */
export interface AlertMessage {
  title: string;
  body: string;
  tag: string;
}

export function lineAlert(
  analysisId: string | null,
  symbol: string,
  hit: Pick<LineCrossing, "drawingId" | "direction" | "price">,
  label: string,
): AlertMessage {
  return {
    title: "Chart alert",
    body: `${symbol} crossed ${hit.direction === "up" ? "above" : "below"} ${label} at ${fmtNumber(hit.price)}`,
    tag: `alert-${analysisId ?? symbol}-${hit.drawingId}`,
  };
}

export function zoneAlert(
  analysisId: string | null,
  symbol: string,
  event: ZoneEvent,
  zone: Pick<SrZone, "id" | "label" | "low" | "high">,
): AlertMessage {
  const range = `${zone.label ? `${zone.label} ` : ""}${fmtNumber(zone.low)} to ${fmtNumber(zone.high)}`;
  return {
    title: "Zone alert",
    body:
      event.kind === "enter"
        ? `${symbol} entered the zone ${range}`
        : `${symbol} broke ${event.direction === "up" ? "above" : "below"} the zone ${range}`,
    tag: `alert-${analysisId ?? symbol}-zone-${zone.id}-${event.kind}`,
  };
}
