import { describe, expect, it } from "vitest";
import { parseAuto } from "../src/detect";
import { parseHistory } from "../src/formats/history";
import { historyFormat } from "../src/formats/history";
import { ibkr } from "../src/formats/ibkr";
import { thinkorswim } from "../src/formats/thinkorswim";
import { tradezella } from "../src/formats/tradezella";
import { tradervue } from "../src/formats/simple";
import type { ImportDiagnostic } from "../src/types";

const codes = (diagnostics: ImportDiagnostic[] | undefined) =>
  (diagnostics ?? []).map((d) => d.code);

describe("ninjatrader diagnostics", () => {
  const header =
    "Instrument,Action,Quantity,Price,Time,Account,Connection,Execution ID,Commission,Ex";
  const csv = (rows: string[]) => [header, ...rows].join("\n");

  it("flags an invalid commission", () => {
    const parsed = parseAuto(
      csv([
        "MNQ 06-26,Buy,1,18000.25,2026-03-02 09:31:00,SIM123,NinjaTrader,e1,not-a-number,Entry",
      ]),
      { timeZone: "UTC" },
    )!;
    expect(parsed.format).toBe("ninjatrader");
    expect(parsed.errors?.length).toBeGreaterThan(0);
    expect(codes(parsed.diagnostics)).toContain("execution_invalid_commission");
  });

  it("reports fills without execution IDs and multiple source accounts with params", () => {
    const parsed = parseAuto(
      csv([
        "MNQ,Buy,1,18000.25,2026-03-02 09:31:00,SIM123,NinjaTrader,,1.24,Entry",
        "MNQ,Sell,1,18010.50,2026-03-02 09:35:00,SIM456,NinjaTrader,,1.24,Exit",
      ]),
      { timeZone: "UTC" },
    )!;
    const list = codes(parsed.diagnostics);
    expect(list).toContain("no_execution_id");
    expect(list).toContain("multiple_source_accounts");
    const multi = parsed.diagnostics!.find((d) => d.code === "multiple_source_accounts")!;
    expect(multi.params).toEqual({ count: 2 });
  });

  it("flags an unrecognized Entry/Exit value", () => {
    const parsed = parseAuto(
      csv(["MNQ,Buy,1,18000.25,2026-03-02 09:31:00,SIM123,NinjaTrader,e1,1.24,Sideways"]),
      { timeZone: "UTC" },
    )!;
    expect(parsed.errors?.length).toBeGreaterThan(0);
    expect(codes(parsed.diagnostics)).toContain("execution_invalid_effect");
  });

  it("asks for futures multipliers with the affected symbols", () => {
    const parsed = parseAuto(
      csv(["NQ 06-26,Buy,1,18000.25,2026-03-02 09:31:00,SIM123,NinjaTrader,e1,1.24,Entry"]),
      { timeZone: "UTC" },
    )!;
    const diag = parsed.diagnostics!.find((d) => d.code === "futures_multiplier_required");
    expect(diag?.params).toEqual({ symbols: "NQ" });
  });
});

describe("fills diagnostics (Open/Close position exports)", () => {
  const header = "Date,Time,Symbol,Quantity,Price,Side,Commission";
  it("flags mixed Open/Close and plain actions for one symbol", () => {
    const parsed = tradervue.parse(
      [
        header,
        "2026-03-02,09:31:00,AAPL,10,180,Open Long,1",
        "2026-03-02,09:35:00,AAPL,10,181,Buy,1",
      ].join("\n"),
      { timeZone: "UTC" },
    );
    expect(parsed.errors?.length).toBeGreaterThan(0);
    const mixed = parsed.diagnostics!.find((d) => d.code === "mixed_position_labels");
    expect(mixed?.params).toEqual({ symbol: "AAPL" });
  });

  it("flags an incomplete position row", () => {
    const parsed = tradervue.parse(
      [header, "2026-03-02,09:31:00,AAPL,,181,Open Long,1"].join("\n"),
      { timeZone: "UTC" },
    );
    expect(codes(parsed.diagnostics)).toContain("invalid_position_fill");
  });

  it("notes when Open/Close labels drive the parse", () => {
    const parsed = tradervue.parse(
      [
        header,
        "2026-03-02,09:31:00,AAPL,10,180,Open Long,1",
        "2026-03-02,09:35:00,AAPL,-10,181,Close Long,1",
      ].join("\n"),
      { timeZone: "UTC" },
    );
    expect(parsed.errors ?? []).toEqual([]);
    expect(codes(parsed.diagnostics)).toContain("position_labels_used");
  });
});

describe("statement formats diagnostics", () => {
  it("tradezella marks trade-level reconstruction", () => {
    const parsed = tradezella.parse(
      "Open Date,Close Date,Symbol,Volume,Entry Price,Exit Price,Net P&L,Commissions\n" +
        "2026-03-02 09:31,2026-03-02 10:00,AAPL,10,180,181,8.76,1.24",
      { timeZone: "UTC" },
    );
    expect(parsed.executions).toHaveLength(2);
    expect(parsed.diagnostics).toEqual([{ code: "trade_level_reconstructed" }]);
  });

  it("ibkr reports a missing Trades section", () => {
    const parsed = ibkr.parse("Statement,Header\n", { timeZone: "UTC" });
    expect(parsed.warnings).toEqual(["No Trades section found."]);
    expect(parsed.diagnostics).toEqual([{ code: "section_not_found" }]);
  });

  it("thinkorswim reports a missing account trade history section", () => {
    const parsed = thinkorswim.parse("Account Statement\n", { timeZone: "UTC" });
    expect(parsed.diagnostics).toEqual([{ code: "section_not_found" }]);
  });
});

describe("history diagnostics", () => {
  it("falls back to columns_unrecognized when no signature matches", () => {
    const parsed = historyFormat.parse("not,a,parseable,file\n1,2,3", { timeZone: "UTC" });
    expect(parsed.errors).toEqual(["History columns could not be recognized."]);
    expect(parsed.diagnostics).toEqual([{ code: "columns_unrecognized" }]);
  });

  it("maps structured history issues to snake_case codes with row params", () => {
    const parsed = parseHistory(
      [
        "Trade ID,Symbol,Direction,Quantity,Entry Time,Entry Price,Exit Time,Exit Price",
        "1,AAPL,long,10,2026-03-02 09:31:00,180,2026-03-02 10:00:00,181",
        "2,AAPL,long,10,2026-03-02 11:00:00,not-a-price,2026-03-02 11:30:00,182",
      ].join("\n"),
      { timeZone: "UTC", adapterId: "generic-csv" },
    )!;
    expect(parsed.executions.length).toBeGreaterThan(0);
    // The generic mapper reports the bad row as a structured issue; it maps to
    // a snake_case diagnostic with the source row number.
    const skipped = parsed.diagnostics!.find((d) => d.code === "row_skipped");
    expect(skipped?.params).toEqual({ row: 3 });
  });

  it("requires a symbol when rows carry none and none can be inferred", () => {
    const parsed = parseHistory(
      [
        "Trade ID,Direction,Quantity,Entry Time,Entry Price,Exit Time,Exit Price",
        "1,long,10,2026-03-02 09:31:00,180,2026-03-02 10:00:00,181",
      ].join("\n"),
      { timeZone: "UTC", adapterId: "generic-csv" },
    )!;
    expect(parsed.errors).toContain("Choose the symbol for this file before importing.");
    expect(codes(parsed.diagnostics)).toContain("symbol_required");
  });
});
