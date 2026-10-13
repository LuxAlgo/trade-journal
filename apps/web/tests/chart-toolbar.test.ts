import { describe, expect, it } from "vitest";
import { TOOLBAR_SHOWN, parseToolbarHidden } from "../src/lib/chart-toolbar";

describe("the drawing toolbar can be hidden", () => {
  it("shows by default and when the stored choice is unreadable", () => {
    expect(parseToolbarHidden(null)).toEqual(TOOLBAR_SHOWN);
    expect(parseToolbarHidden("not json")).toEqual(TOOLBAR_SHOWN);
    expect(parseToolbarHidden('"hidden"')).toEqual(TOOLBAR_SHOWN);
  });

  it("remembers full screen apart from the normal view", () => {
    expect(parseToolbarHidden(JSON.stringify({ fullscreen: true }))).toEqual({
      normal: false,
      fullscreen: true,
    });
    expect(parseToolbarHidden(JSON.stringify({ normal: true, fullscreen: "yes" }))).toEqual({
      normal: true,
      fullscreen: false,
    });
  });
});
