import { describe, expect, it } from "vitest";
import { privacyPreference } from "../src/lib/privacy-preference";

describe("global privacy preference", () => {
  it("carries forward the dashboard setting before the first global toggle", () => {
    expect(privacyPreference(null, '{"privacy":true}')).toBe(true);
    expect(privacyPreference(null, '{"privacy":false}')).toBe(false);
    expect(privacyPreference(null, null)).toBe(false);
  });
  it("gives the global setting priority over old saved layouts", () => {
    expect(privacyPreference("false", '{"privacy":true}')).toBe(false);
    expect(privacyPreference("true", '{"privacy":false}')).toBe(true);
  });
  it("hides amounts when a stored preference is corrupted", () => {
    expect(privacyPreference("broken", null)).toBe(true);
    expect(privacyPreference(null, "broken")).toBe(true);
  });
});
