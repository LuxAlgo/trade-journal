import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildRoundTrips } from "@luxalgo/journal-core";
import { parseAuto } from "../src/detect";

// Reporter-provided, anonymized fixture from LuxAlgo/trade-journal issue #10:
// https://github.com/user-attachments/files/32268941/tradeify_sample_anonymized.csv
const sample = readFileSync(
  new URL("./fixtures/ninjatrader-copy-trades.csv", import.meta.url),
  "utf8",
);
const parse = (content: string) => parseAuto(content, { timeZone: "UTC" })!;
const identity = (content: string) =>
  parse(content)
    .executions.map((e) => JSON.stringify([e.importMetadata?.group, e.importMetadata?.id]))
    .sort();
const trips = (content: string, multipliers = {}) =>
  buildRoundTrips(
    parse(content).executions.map((e, i) => ({
      ...e,
      id: String(i),
      accountId: "destination",
      source: "import" as const,
    })),
    { multipliers },
  );
const csv = (rows: string[]) =>
  [
    "Instrument,Action,Quantity,Price,Time,Account,Connection,Execution ID,Commission",
    ...rows,
  ].join("\n");

describe("NinjaTrader execution identity", () => {
  it.each(["ID", "Execution ID"])("recognizes the %s execution identity column", (header) => {
    const content = csv(["AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e1,0"]).replace(
      "Execution ID",
      header,
    );
    expect(parse(content).executions[0]?.importMetadata?.id).toBe("execution:e1");
    expect(parse(content).warnings).toEqual([]);
  });
  it("preserves all 26 copy-traded fills, including same-account repetitions", () => {
    const result = parse(sample);
    expect(result.format).toBe("ninjatrader");
    expect(result.executions).toHaveLength(26);
    expect(result.skippedRows).toBe(0);
    expect(result.errors).toEqual([]);
    expect(new Set(identity(sample)).size).toBe(26);
    expect(new Set(result.executions.map((e) => e.importMetadata?.group)).size).toBe(5);
    const trades = trips(sample, { MNQZ6: 2 });
    expect(trades).toHaveLength(5);
    expect(
      trades.every(
        (t) => t.status === "win" && t.openQuantity === 0 && t.quantity === 12 && t.netPnl === 1053,
      ),
    ).toBe(true);
    expect(trades.reduce((sum, t) => sum + t.netPnl, 0)).toBe(5265);
    expect(trades.reduce((sum, t) => sum + t.executionCount, 0)).toBe(26);
    expect(result.warnings.join(" ")).toContain("5 source accounts");
    expect(result.warnings.join(" ")).toContain("Overlapping exports");
  });

  it("keeps identities stable across reordering and insertion of unrelated records", () => {
    const [header, ...rows] = sample.trim().split(/\r?\n/);
    expect(identity([header, ...rows.toReversed()].join("\n"))).toEqual(identity(sample));
    expect(identity(sample.replace(/\r?\n/g, "\r\n"))).toEqual(identity(sample));
    const extra = "MNQZ6,Buy,9/16/2026 9:30,29400,Entry,TRADEIFY,1,ACCOUNT-1";
    const extended = identity([header, extra, ...rows].join("\n"));
    expect(extended).toHaveLength(27);
    expect(extended).toEqual(expect.arrayContaining(identity(sample)));
  });

  it("uses execution IDs, not shared order IDs, for identical partial fills", () => {
    const content = csv([
      "AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e1,0",
      "AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e2,0",
      "AAPL,Sell,2,101,2026-09-15 09:31,A,broker,e3,0",
    ]);
    expect(parse(content).executions.map((e) => e.importMetadata?.id)).toEqual([
      "execution:e1",
      "execution:e2",
      "execution:e3",
    ]);
    expect(trips(content)[0]).toMatchObject({ quantity: 2, netPnl: 2, openQuantity: 0 });
    const orderOnly = content.replace("Execution ID", "Order ID").replaceAll("e2", "e1");
    expect(new Set(identity(orderOnly)).size).toBe(3);
    expect(parse(orderOnly).warnings.join(" ")).toContain("No execution ID");
  });

  it("namespaces reused execution IDs by account, connection and full contract", () => {
    const content = csv([
      "ES 03-26,Buy,1,100,2026-09-15 09:30,A,broker1,e1,0",
      "ES 03-26,Sell,1,100,2026-09-15 09:30,B,broker1,e1,0",
      "ES 03-26,Sell,1,100,2026-09-15 09:30,A,broker2,e1,0",
      "ES 06-26,Sell,1,100,2026-09-15 09:30,A,broker1,e1,0",
    ]);
    expect(parse(content).errors).toEqual([]);
    expect(new Set(identity(content)).size).toBe(4);
    expect(trips(content)).toHaveLength(4);
    expect(trips(content).every((t) => t.openQuantity === 1)).toBe(true);
  });

  it("rejects contradictory rows with the same execution identity", () => {
    const content = csv([
      "AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e1,0",
      "AAPL,Buy,1,101,2026-09-15 09:30,A,broker,e1,0",
    ]);
    expect(parse(content).errors?.join(" ")).toContain("execution ID describes different fills");
  });

  it("preserves repeated fills without account columns and reports the limitation", () => {
    const content =
      "Instrument,Action,Quantity,Price,Time\nAAPL,Buy,1,100,2026-09-15 09:30\nAAPL,Buy,1,100,2026-09-15 09:30";
    expect(new Set(identity(content)).size).toBe(2);
    expect(parse(content).warnings.join(" ")).toContain("no source account");
  });

  it("skips malformed rows without shifting valid identities, preserves fees and flags futures", () => {
    const content = csv([
      "AAPL,Buy,invalid,100,2026-09-15 09:30,A,broker,bad,0",
      "AAPL,Buy,1,100,2026-09-15 09:30,A,broker,e1,0",
      "AAPL,Sell,1,101,2026-09-15 09:31,A,broker,e2,0.25",
    ]);
    const result = parse(content);
    expect(result.skippedRows).toBe(1);
    expect(result.executions.map((e) => e.fee)).toEqual([0, 0.25]);
    expect(result.executions.every((e) => e.importMetadata?.preserveFee)).toBe(true);
    expect(trips(content)[0]?.netPnl).toBe(0.75);
    expect(parse(sample).executions.every((e) => e.assetClass === "futures")).toBe(true);
    expect(parse(sample).warnings.join(" ")).toContain("MNQZ6");
  });
});
