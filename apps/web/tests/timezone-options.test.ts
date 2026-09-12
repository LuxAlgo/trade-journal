import { describe, expect, it } from "vitest";
import { timeZoneLabel, timeZoneOptions } from "../src/lib/timezone-options";

describe("searchable timezone choices", () => {
  it("includes every primary timezone supported by the runtime plus UTC", () => {
    const options = timeZoneOptions("");
    expect(options[0]).toBe("UTC");
    for (const zone of Intl.supportedValuesOf("timeZone")) expect(options).toContain(zone);
    expect(new Set(options).size).toBe(options.length);
  });

  it("finds cities regardless of capitalization, accents, underscores, or word order", () => {
    expect(timeZoneOptions("", "HELSINKI")).toEqual(["Europe/Helsinki"]);
    expect(timeZoneOptions("", "jamaica")).toContain("America/Jamaica");
    expect(timeZoneOptions("", "Asunción")).toEqual(["America/Asuncion"]);
    expect(timeZoneOptions("", "New York")).toEqual(["America/New_York"]);
    expect(timeZoneOptions("", "york america")).toEqual(["America/New_York"]);
  });

  it("keeps saved aliases and allows selecting valid full names omitted by the primary list", () => {
    expect(timeZoneOptions("US/Eastern")).toContain("US/Eastern");
    expect(timeZoneOptions("", "US/Eastern")).toEqual(["US/Eastern"]);
    expect(timeZoneOptions("", "Etc/GMT+5")).toEqual(["Etc/GMT+5"]);
    expect(timeZoneOptions("", "  Europe/Kyiv  ")).toContain("Europe/Kyiv");
  });

  it("never offers a misspelled timezone as a selectable custom value", () => {
    expect(timeZoneOptions("", "Europe/Helsinkii")).toEqual([]);
    expect(timeZoneOptions("", "Mars/Olympus")).toEqual([]);
    expect(timeZoneOptions("invalid-saved-zone")).not.toContain("invalid-saved-zone");
  });

  it("shows human-readable names while keeping region context", () => {
    expect(timeZoneLabel("America/Argentina/Buenos_Aires")).toBe(
      "America / Argentina / Buenos Aires",
    );
    expect(timeZoneLabel("UTC")).toBe("UTC");
  });
});
