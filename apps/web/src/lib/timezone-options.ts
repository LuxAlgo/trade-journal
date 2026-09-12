import { isTimeZone } from "./timezone";

let supportedZones: string[] | undefined;

/** Human-readable names retain the region so similarly named cities stay distinct. */
export const timeZoneLabel = (zone: string): string =>
  zone.replaceAll("_", " ").replaceAll("/", " / ");

const searchKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_/\s]+/g, " ")
    .trim();

/**
 * Intl lists primary zones, but omits UTC and many valid aliases. Keep saved
 * aliases and offer any exact, valid name entered in search as a selectable row.
 * Search text itself is never used as the setting.
 */
export const timeZoneOptions = (current: string, query = ""): string[] => {
  if (!supportedZones) {
    try {
      supportedZones = Intl.supportedValuesOf("timeZone");
    } catch {
      // Older browsers can still select their current zone or search a full valid name.
      supportedZones = [];
    }
  }
  const zones = new Set(["UTC", ...supportedZones]);
  const candidate = query.trim().replaceAll(" ", "_");
  for (const zone of [current, candidate]) {
    if (!zone || !isTimeZone(zone)) continue;
    // Avoid adding a second row for capitalization-only differences in a search.
    if (!Array.from(zones).some((existing) => existing.toLowerCase() === zone.toLowerCase()))
      zones.add(zone);
  }
  const words = searchKey(query).split(" ").filter(Boolean);
  return [...zones]
    .filter((zone) => words.every((word) => searchKey(zone).includes(word)))
    .sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)));
};
