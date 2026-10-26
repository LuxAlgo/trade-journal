import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildRoundTrips, type Execution } from "@luxalgo/journal-core";
import { detectFormat, parseAuto } from "../src/detect";

// Reporter-provided, anonymized fixture from LuxAlgo/trade-journal issue #53:
// 100 random rows with prices, sizes and times scaled or shifted, so opening and
// closing fills don't pair up. It validates parsing, not position history.
const sample = readFileSync(
  new URL("./fixtures/hyperliquid-trade-history.csv", import.meta.url),
  "utf8",
);
const HEADER = "time,coin,dir,px,sz,ntl,fee,closedPnl";
const csv = (rows: string[]) => [HEADER, ...rows].join("\n");
const parse = (content: string, timeZone = "UTC") => parseAuto(content, { timeZone })!;
const ids = (content: string) =>
  parse(content)
    .executions.map((e) => e.importMetadata!.id)
    .sort();
const trips = (executions: Omit<Execution, "id" | "accountId">[]) =>
  buildRoundTrips(executions.map((e, i) => ({ ...e, id: String(i), accountId: "hl" })));

describe("Hyperliquid trade history exports import as perpetual fills", () => {
  it("the issue #53 export is detected and all 100 fills import", () => {
    expect(detectFormat(sample)?.id).toBe("hyperliquid");
    const result = parse(sample);
    expect(result.errors).toBeUndefined();
    expect(result.skippedRows).toBe(0);
    expect(result.executions).toHaveLength(100);
    expect(result.executions[0]).toMatchObject({
      symbol: "BTC",
      side: "sell",
      quantity: 0.000295163,
      price: 107376,
      fee: 0.004564,
      executedAt: "2025-11-08T19:31:18.000Z",
      importMetadata: { order: 0, preserveFee: true },
    });
    expect(result.executions.filter((e) => e.side === "buy")).toHaveLength(48);
    expect(result.executions.filter((e) => e.side === "sell")).toHaveLength(52);
  });

  it("a Price Improved annotation keeps the fill's direction", () => {
    const result = parse(
      csv([
        "11/9/2025 - 04:50:53,ETH,Close Long (Price Improved),3580.3,0.0127904,45.793541,0.006593,1.591611",
        "11/26/2025 - 19:52:46,SOL,Open Long (Price Improved),145.29,0.216453,31.448378,0.004528,-0.004528",
      ]),
    );
    expect(result.errors).toBeUndefined();
    expect(result.executions.map((e) => [e.symbol, e.side])).toEqual([
      ["ETH", "sell"],
      ["SOL", "buy"],
    ]);
  });

  it("symbols match broker sync's coin names: HIP-3 markets are dex:COIN and case is kept", () => {
    const result = parse(
      csv([
        "11/13/2025 - 00:00:53,ANTH (io),Open Long,2825.3,0.00688714,19.458223,0.000559,-0.000559",
        "11/23/2025 - 18:58:07,SPCX (xyz),Close Long,222.225,4.48648,997.007526,0.028714,104.707731",
        "11/24/2025 - 08:00:00,kPEPE,Open Short,0.0061,1000,6.1,0.001,-0.001",
      ]),
    );
    expect(result.executions.map((e) => e.symbol)).toEqual(["io:ANTH", "xyz:SPCX", "kPEPE"]);
    expect(new Set(parse(sample).executions.map((e) => e.symbol))).toEqual(
      new Set(["BTC", "ETH", "SOL", "BNB", "HYPE", "io:ANTH", "xyz:SPCX"]),
    );
  });

  it("times are read in the statement timezone", () => {
    expect(parse(sample, "Europe/Paris").executions[0]!.executedAt).toBe(
      "2025-11-08T18:31:18.000Z",
    );
    expect(parse(sample, "America/New_York").executions[0]!.executedAt).toBe(
      "2025-11-09T00:31:18.000Z",
    );
  });

  it("identical fills stay separate, and the same or a reordered export imports once", () => {
    const identical = parse(sample).executions.filter(
      (e) => e.symbol === "BTC" && e.executedAt === "2025-11-10T13:05:57.000Z",
    );
    expect(identical).toHaveLength(2);
    expect(new Set(identical.map((e) => e.importMetadata!.id)).size).toBe(2);
    expect(new Set(ids(sample)).size).toBe(100);
    const [header, ...rows] = sample.trim().split("\n");
    expect(ids([header, ...rows.reverse()].join("\n"))).toEqual(ids(sample));
  });

  it("fills net with synced fills of the same coin: a file's open and a synced close make one trade", () => {
    const [open] = parse(
      csv(["10/1/2026 - 09:00:00,ETH,Open Long,3000,1,3000,0.5,-0.5"]),
    ).executions;
    expect(open!.importMetadata!.group).toBeUndefined();
    const synced = {
      symbol: "ETH",
      side: "sell" as const,
      quantity: 1,
      price: 3100,
      fee: 0.5,
      executedAt: "2026-10-02T09:00:00.123Z",
      source: "sync" as const,
    };
    expect(trips([{ ...open!, source: "import" }, synced])).toMatchObject([
      { direction: "long", status: "win", grossPnl: 100, netPnl: 99 },
    ]);
  });

  it("shorts and flips through flat become separate trades", () => {
    const result = parse(
      csv([
        "10/1/2026 - 09:00:00,ETH,Open Short,100,1,100,0.1,-0.1",
        "10/1/2026 - 10:00:00,ETH,Short > Long,90,3,270,0.3,9.7",
        "10/1/2026 - 11:00:00,ETH,Close Long,95,2,190,0.2,9.8",
      ]),
    );
    expect(result.errors).toBeUndefined();
    expect(result.executions.map((e) => e.side)).toEqual(["sell", "buy", "sell"]);
    expect(
      trips(result.executions.map((e) => ({ ...e, source: "import" as const }))),
    ).toMatchObject([
      { direction: "short", grossPnl: 10, quantity: 1 },
      { direction: "long", grossPnl: 10, quantity: 2 },
    ]);
  });

  it("spot fills are skipped with a reason; the perpetual fills still import", () => {
    const result = parse(
      csv([
        "10/1/2026 - 09:00:00,HYPE/USDC,Buy,40,1,40,0.0004,0",
        "10/1/2026 - 09:05:00,HYPE/USDC,Sell,41,1,41,0.04,0",
        "10/1/2026 - 09:10:00,HYPE,Open Long,40,1,40,0.01,-0.01",
      ]),
    );
    expect(result.errors).toBeUndefined();
    expect(result.executions.map((e) => e.symbol)).toEqual(["HYPE"]);
    expect(result.skippedRows).toBe(2);
    expect(result.warnings.join(" ")).toMatch(/2 spot fill\(s\) were skipped/);
  });

  it("an unknown direction or an unreadable fill stops the import instead of being guessed", () => {
    const unknown = parse(
      csv([
        "10/1/2026 - 09:00:00,ETH,Open Long,3000,1,3000,0.5,-0.5",
        "10/1/2026 - 09:30:00,ETH,Auto-Deleveraging,2500,1,2500,0,-500",
      ]),
    );
    expect(unknown.errors?.join(" ")).toMatch(
      /Unrecognized Hyperliquid direction: "Auto-Deleveraging"/,
    );
    const unreadable = parse(
      csv([
        "10/1/2026 - 09:00:00,ETH,Open Long,3000,1,3000,0.5,-0.5",
        "10/1/2026 - 09:30:00,ETH,Close Long,,1,2500,0,-500",
      ]),
    );
    expect(unreadable.errors?.join(" ")).toMatch(/1 perpetual fill\(s\) are missing/);
  });
});
