import { expect, it } from "vitest";
import { parseCsv } from "../src/csv";
import { parseWithMapping, readHeaders } from "../src/formats/generic";

it.each([
  [",", ";"],
  [";", ","],
  ["\t", ","],
])("quoted punctuation does not change the separator %j", (delimiter, punctuation) => {
  const header = ["Notes", "entry", "exit", "review"].join(punctuation);
  const content = `Symbol${delimiter}"${header}"\nAAPL${delimiter}"Said ""hold"""`;
  expect(parseCsv(content)).toEqual([
    ["Symbol", header],
    ["AAPL", 'Said "hold"'],
  ]);
});

it("a quoted header can span lines and contain escaped quotes", () => {
  const content = '"Notes ""entry, exit""\nreview";Symbol\n"Hold";AAPL';
  expect(parseCsv(content)).toEqual([
    ['Notes "entry, exit"\nreview', "Symbol"],
    ["Hold", "AAPL"],
  ]);
});

it.each(["\n", "\r\n", "\r"])(
  "data rows do not change separator detection with line ending %j",
  (lineEnding) => {
    expect(parseCsv(`Symbol;Notes${lineEnding}AAPL;"entry, exit, stop, target"`)).toEqual([
      ["Symbol", "Notes"],
      ["AAPL", "entry, exit, stop, target"],
    ]);
  },
);

it("a mapped statement imports when a quoted column name contains commas", () => {
  const content = `When;Ticker;Side;Quantity;Price;"Notes, entry, exit, stop, target, review"
2026-01-05 09:31:00;AAPL;Buy;10;185,50;Opening fill`;
  expect(readHeaders(content)).toEqual([
    "When",
    "Ticker",
    "Side",
    "Quantity",
    "Price",
    "Notes, entry, exit, stop, target, review",
  ]);
  const result = parseWithMapping(content, {
    timestamp: "When",
    symbol: "Ticker",
    side: "Side",
    quantity: "Quantity",
    price: "Price",
  });
  expect(result.skippedRows).toBe(0);
  expect(result.executions).toEqual([
    {
      symbol: "AAPL",
      side: "buy",
      quantity: 10,
      price: 185.5,
      fee: 0,
      executedAt: "2026-01-05T09:31:00.000Z",
    },
  ]);
});
