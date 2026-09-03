export const PRIVACY_KEY = "journal-privacy-v1";
export const LEGACY_LAYOUT_KEY = "journal-dashboard-layouts-v1";

export function privacyPreference(current: string | null, legacy: string | null): boolean {
  if (current !== null) return current !== "false";
  if (legacy !== null) {
    try {
      return Boolean(JSON.parse(legacy).privacy);
    } catch {
      return true;
    }
  }
  return false;
}
