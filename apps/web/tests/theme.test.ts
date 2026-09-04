import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { THEME_INIT_SCRIPT, THEME_KEY, themePreference } from "../src/lib/theme";

describe("journal appearance", () => {
  it("defaults to dark and accepts only explicit light or dark choices", () => {
    expect(themePreference(null)).toBe("dark");
    expect(themePreference("system")).toBe("dark");
    expect(themePreference("invalid")).toBe("dark");
    expect(themePreference("dark")).toBe("dark");
    expect(themePreference("light")).toBe("light");
  });
  it.each([null, "dark", "light", "invalid"])("applies %s before hydration", (saved) => {
    const calls: unknown[] = [];
    runInNewContext(THEME_INIT_SCRIPT, {
      localStorage: {
        getItem: (key: string) => {
          expect(key).toBe(THEME_KEY);
          return saved;
        },
      },
      document: {
        documentElement: { classList: { toggle: (...args: unknown[]) => calls.push(args) } },
      },
    });
    expect(calls).toEqual([["dark", themePreference(saved) === "dark"]]);
  });
  it("still renders dark when browser storage is blocked", () => {
    let dark = false;
    runInNewContext(THEME_INIT_SCRIPT, {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      document: {
        documentElement: {
          classList: {
            toggle: (_: string, value: boolean) => {
              dark = value;
            },
          },
        },
      },
    });
    expect(dark).toBe(true);
  });
});
