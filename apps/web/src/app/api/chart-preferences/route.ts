import { handler, ok } from "@/server/api";
import { getChartPreferences, saveChartPreferences } from "@/server/chart-preferences";

/** Chart looks, saved looks, defaults, per-symbol and per-tool settings. */
export const GET = handler(() => ok({ preferences: getChartPreferences() }));

export const PUT = handler(async (request: Request) =>
  ok({ preferences: saveChartPreferences(await request.json()) }),
);
