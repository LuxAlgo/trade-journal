import { handler, ok, requireValue } from "@/server/api";
import { dayTypeBreakdown } from "@/server/day-types";

const PERIODS = new Set([30, 90, 180, 365]);

/** Closed trades by day type over the last `days` (30, 90, 180 or 365). */
export const GET = handler(async (request: Request) => {
  const days = Number(new URL(request.url).searchParams.get("days") ?? 90);
  requireValue(PERIODS.has(days), "Choose 30, 90, 180 or 365 days.");
  return ok(await dayTypeBreakdown(days, request.signal));
});
