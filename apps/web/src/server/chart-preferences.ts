import {
  parsePreferences,
  preferencesProblem,
  type ChartPreferences,
} from "@/lib/chart-preferences";
import { RequestError } from "./api";
import { getSetting, setSetting } from "./settings";

const KEY = "chartPreferences";

export const getChartPreferences = (): ChartPreferences => parsePreferences(getSetting(KEY));

/** Replace the stored preferences after validating the whole document. */
export function saveChartPreferences(value: unknown): ChartPreferences {
  const problem = preferencesProblem(value);
  if (problem) throw new RequestError(problem);
  setSetting(KEY, JSON.stringify(value));
  return getChartPreferences();
}
