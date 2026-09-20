import { describe, expect, it } from "vitest";
import {
  isIbkrFlexXml,
  parseIbkrFlexSync,
  parseIbkrFlexXmlImport,
} from "../src/server/ibkr-flex-sync";

const statement = (body: string) =>
  `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1">${body}</FlexStatement></FlexStatements></FlexQueryResponse>`;

describe("IBKR Flex sync enrichment", () => {
  it("groups vertical legs and closes zero-value expirations", () => {
    const result = parseIbkrFlexSync(
      statement(`
        <Trades>
          <Trade accountId="U1" assetCategory="OPT" symbol="SPXW  260102C06000000" dateTime="20260102;100000" buySell="SELL" quantity="-1" tradePrice="2.00" ibCommission="-1.20" ibOrderID="42" tradeID="t1" openCloseIndicator="O" notes="CP" />
          <Trade accountId="U1" assetCategory="OPT" symbol="SPXW  260102C06015000" dateTime="20260102;100000" buySell="BUY" quantity="1" tradePrice="0.50" ibCommission="-1.10" ibOrderID="42" tradeID="t2" openCloseIndicator="O" notes="CP" />
        </Trades>
        <OptionEAE>
          <OptionEAE accountId="U1" assetCategory="OPT" symbol="SPXW  260102C06000000" date="2026-01-02" transactionType="Expiration" quantity="1" tradePrice="0" realizedPnl="198.80" multiplier="100" />
          <OptionEAE accountId="U1" assetCategory="OPT" symbol="SPXW  260102C06015000" date="2026-01-02" transactionType="Expiration" quantity="1" tradePrice="0" realizedPnl="-51.10" multiplier="100" />
        </OptionEAE>
        <OpenPositions />
      `),
      new Date("2026-01-03T00:00:00Z"),
    );

    expect(result.warnings).toEqual([]);
    expect(result.stats).toMatchObject({
      trades: 2,
      lifecycleEvents: 2,
      lifecycleClosures: 2,
      unresolvedLifecycleEvents: 0,
      expiredContractsWithoutLifecycle: 0,
      identifiedSpreadOrders: 1,
    });
    expect(result.executions).toHaveLength(4);
    expect(result.executions.slice(0, 2).map((row) => row.importMetadata?.broker)).toEqual([
      expect.objectContaining({
        orderId: "42",
        openCloseIndicator: "O",
        notes: "CP",
        strategyGroupId: "ibkr-order:U1:42",
      }),
      expect.objectContaining({ strategyGroupId: "ibkr-order:U1:42" }),
    ]);
    expect(result.executions.slice(2).map((row) => [row.side, row.price])).toEqual([
      ["buy", 0],
      ["sell", 0],
    ]);
  });

  it("uses proceeds when lifecycle Trade Price is absent", () => {
    const result = parseIbkrFlexSync(
      statement(`
        <Trade accountId="U1" assetCategory="OPT" symbol="SPXW  260102C06000000" dateTime="20260102;100000" buySell="BUY" quantity="1" tradePrice="2" />
        <OptionEAE accountId="U1" assetCategory="OPT" symbol="SPXW  260102C06000000" date="20260102" transactionType="Cash Settlement" quantity="1" proceeds="500" multiplier="100" />
      `),
      new Date("2026-01-03T00:00:00Z"),
    );
    expect(result.executions[1]).toMatchObject({ side: "sell", price: 5 });
    expect(result.warnings).toEqual([]);
  });

  it("derives SPX cash settlement and clamps pre-window closing quantity", () => {
    const result = parseIbkrFlexSync(
      statement(`
        <Trade accountId="U1" assetCategory="OPT" symbol="SPXW  250919C06655000" dateTime="20250919;104715" buySell="SELL" quantity="-1" tradePrice="2.22" ibCommission="-1.64" openCloseIndicator="O" />
        <Trade accountId="U1" assetCategory="OPT" symbol="SPXW  250919C06655000" dateTime="20250919;162000" buySell="BUY" quantity="2" tradePrice="0" ibCommission="-0.20" multiplier="100" costBasis="441.180933" fifoPnlRealized="-1430.819067" transactionType="BookTrade" openCloseIndicator="C" notes="A" />
        <Trade accountId="U1" assetCategory="OPT" symbol="SPXW  250919C06655000" dateTime="20250919;162000" buySell="BUY" quantity="2" tradePrice="0" multiplier="100" costBasis="441.180933" fifoPnlRealized="-1430.819067" transactionType="BookTrade" openCloseIndicator="C" notes="A" />
      `),
      new Date("2025-09-20T00:00:00Z"),
    );
    expect(result.executions).toHaveLength(2);
    expect(result.executions[1]).toMatchObject({
      side: "buy",
      quantity: 1,
      price: 9.36,
      importMetadata: {
        broker: { settlementPriceSource: "realized-pnl-basis" },
      },
    });
    expect(result.stats.expiredContractsWithoutLifecycle).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/limited to the position visible/);
  });

  it("reports when expired contracts have no lifecycle value", () => {
    const result = parseIbkrFlexSync(
      statement(`
        <Trade accountId="U1" assetCategory="OPT" symbol="SPXW  260102P05900000" dateTime="20260102;100000" buySell="SELL" quantity="-1" tradePrice="1.25" />
        <Trade accountId="U1" assetCategory="OPT" symbol="SPXW  260102P05885000" dateTime="20260102;100000" buySell="BUY" quantity="1" tradePrice="0.25" />
        <OpenPositions />
      `),
      new Date("2026-01-03T00:00:00Z"),
    );
    expect(result.stats.expiredContractsWithoutLifecycle).toBe(2);
    expect(result.warnings.join(" ")).toMatch(/P&L cannot be determined/);
  });

  it("does not fabricate a lifecycle close without price or proceeds", () => {
    const result = parseIbkrFlexSync(
      statement(`
        <Trade accountId="U1" assetCategory="OPT" symbol="SPXW  260102P05900000" dateTime="20260102;100000" buySell="SELL" quantity="-1" tradePrice="1.25" />
        <OptionEAE accountId="U1" assetCategory="OPT" symbol="SPXW  260102P05900000" date="20260102" transactionType="Expiration" quantity="1" realizedPnl="123.45" />
      `),
      new Date("2026-01-03T00:00:00Z"),
    );
    expect(result.executions).toHaveLength(1);
    expect(result.stats.unresolvedLifecycleEvents).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/lacks enough.*Trade Price or Proceeds/);
  });

  it("retains a closing-only row for matching across uploaded file windows", () => {
    const xml = statement(`
      <Trade accountId="U1" assetCategory="STK" symbol="NVDA" dateTime="20260102;100000" buySell="SELL" quantity="-4" tradePrice="133.91" openCloseIndicator="C" transactionID="tx-close" />
    `);
    expect(isIbkrFlexXml(xml)).toBe(true);
    const result = parseIbkrFlexXmlImport(xml, "Asia/Singapore");
    expect(result.format).toBe("ibkr-flex-xml");
    expect(result.executions).toEqual([
      expect.objectContaining({
        symbol: "NVDA",
        side: "sell",
        quantity: 4,
        executedAt: "2026-01-02T02:00:00.000Z",
        importMetadata: expect.objectContaining({
          id: "ibkr-trade:U1:tx-close",
          group: "ibkr-account:U1",
        }),
      }),
    ]);
  });

  it("uses stable broker IDs across overlapping files and separates Flex accounts", () => {
    const trade =
      '<Trade assetCategory="STK" symbol="NVDA" dateTime="20260102;100000" buySell="BUY" quantity="1" tradePrice="100" transactionID="same-tx" />';
    const first = parseIbkrFlexXmlImport(
      `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1">${trade}</FlexStatement></FlexStatements></FlexQueryResponse>`,
    );
    const second = parseIbkrFlexXmlImport(
      `<FlexQueryResponse><FlexStatements>
        <FlexStatement accountId="U2"><Trade assetCategory="STK" symbol="OTHER" dateTime="20260101;100000" buySell="BUY" quantity="1" tradePrice="1" transactionID="other" /></FlexStatement>
        <FlexStatement accountId="U1">${trade}</FlexStatement>
      </FlexStatements></FlexQueryResponse>`,
    );
    expect(first.executions[0]!.importMetadata?.id).toBe(second.executions[1]!.importMetadata?.id);
    expect(second.executions.map((row) => row.importMetadata?.group)).toEqual([
      "ibkr-account:U2",
      "ibkr-account:U1",
    ]);
  });

  it("keeps economically identical partial fills when broker transaction IDs differ", () => {
    const result = parseIbkrFlexXmlImport(
      statement(`
        <Trade assetCategory="STK" symbol="NVDA" dateTime="20260102;100000" buySell="BUY" quantity="1" tradePrice="100" transactionID="partial-1" />
        <Trade assetCategory="STK" symbol="NVDA" dateTime="20260102;100000" buySell="BUY" quantity="1" tradePrice="100" transactionID="partial-2" />
      `),
    );
    expect(result.executions).toHaveLength(2);
    expect(result.executions.map((row) => row.importMetadata?.id)).toEqual([
      "ibkr-trade:U1:partial-1",
      "ibkr-trade:U1:partial-2",
    ]);
  });
});
