import { describe, it, expect } from "vitest";
import { parseJournalDefaults } from "../src/lib/journal-defaults";

const knows = (id: string) => id === "acct";
const valid = {
  breakeven: 5,
  breakevenMode: "money",
  feeRules: [{ id: "f1", accountId: "acct", symbol: "ES", amount: 2, mode: "unit" }],
  riskRules: [{ id: "r1", accountId: "", symbol: "", stop: 1, target: 3, mode: "percent" }],
};

describe("journal defaults are validated before they are saved", () => {
  it("accepts a well-formed payload and returns exactly the known fields", () => {
    const parsed = parseJournalDefaults(valid, knows);
    expect(parsed.error).toBeUndefined();
    if (parsed.error === undefined) expect(parsed.defaults).toEqual(valid);
  });

  it("rejects unknown top-level fields so arbitrary data is never stored in settings", () => {
    expect(parseJournalDefaults({ ...valid, injected: "<script>" }, knows).error).toMatch(
      /unknown/,
    );
  });

  it("rejects unknown fields inside individual fee or risk defaults", () => {
    const withExtra = {
      ...valid,
      feeRules: [{ ...valid.feeRules[0], note: "extra" }],
    };
    expect(parseJournalDefaults(withExtra, knows).error).toMatch(/unknown/);
  });

  it("rejects non-finite numbers and negative or zero distances", () => {
    expect(parseJournalDefaults({ ...valid, breakeven: NaN }, knows).error).toBeDefined();
    expect(parseJournalDefaults({ ...valid, breakeven: "5" }, knows).error).toBeDefined();
    expect(
      parseJournalDefaults(
        { ...valid, feeRules: [{ ...valid.feeRules[0], amount: Infinity }] },
        knows,
      ).error,
    ).toBeDefined();
    expect(
      parseJournalDefaults({ ...valid, riskRules: [{ ...valid.riskRules[0], stop: 0 }] }, knows)
        .error,
    ).toBeDefined();
  });

  it("rejects defaults that point at an account which does not exist", () => {
    expect(
      parseJournalDefaults(
        { ...valid, feeRules: [{ ...valid.feeRules[0], accountId: "ghost" }] },
        knows,
      ).error,
    ).toMatch(/account/);
  });

  it("rejects payloads that are not objects", () => {
    expect(parseJournalDefaults(null, knows).error).toBeDefined();
    expect(parseJournalDefaults([], knows).error).toBeDefined();
    expect(parseJournalDefaults("defaults", knows).error).toBeDefined();
  });
});
