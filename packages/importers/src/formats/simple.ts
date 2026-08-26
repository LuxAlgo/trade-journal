import { makeFillsFormat } from "./fills";

/** Tradervue executions export: Date,Time,Symbol,Quantity,Price,Side,Commission,TransFee,ECNFee */
export const tradervue = makeFillsFormat({
  id: "tradervue",
  label: "Tradervue (executions export)",
  required: [["date"], ["time"], ["symbol"], ["quantity"], ["price"], ["side"]],
  columns: {
    symbol: ["symbol"],
    side: ["side"],
    quantity: ["quantity"],
    price: ["price"],
    fees: [["commission"], ["transfee"], ["ecnfee"], ["secfee"]],
    date: ["date"],
    time: ["time"],
  },
});

/** TradingView paper-trading history export. */
export const tradingview = makeFillsFormat({
  id: "tradingview",
  label: "TradingView (paper trading history)",
  required: [["symbol"], ["side"], ["fillprice"]],
  columns: {
    symbol: ["symbol"],
    side: ["side"],
    quantity: ["qty", "quantity", "filledqty"],
    price: ["fillprice", "avgfillprice"],
    fees: [["commission"]],
    timestamp: ["closingtime", "time", "placingtime"],
  },
  rowFilter: (row) =>
    !("status" in row) || /filled/i.test(row["status"] ?? "") || row["status"] === "",
  // "NASDAQ:AAPL" → "AAPL"
  normalizeSymbol: (symbol) => symbol.split(":").pop()!.trim().toUpperCase(),
});

/** NinjaTrader executions grid export. */
export const ninjatrader = makeFillsFormat({
  id: "ninjatrader",
  label: "NinjaTrader (executions export)",
  required: [["instrument"], ["action"], ["price"]],
  columns: {
    symbol: ["instrument"],
    side: ["action"],
    quantity: ["quantity", "qty"],
    price: ["price"],
    fees: [["commission"]],
    timestamp: ["time"],
  },
  // "ES 03-26" → "ES"
  normalizeSymbol: (symbol) => symbol.split(" ")[0]!.trim().toUpperCase(),
});

/**
 * Tradovate orders export. Real files (cross-checked against TradeNote's
 * community parser): orderId, Account, Date (M/D/YY), Fill Time, B/S, Contract,
 * Product, Filled Qty, Avg Fill Price, Status — only "Filled" rows are fills.
 */
export const tradovate = makeFillsFormat({
  id: "tradovate",
  label: "Tradovate (orders export)",
  required: [["contract"], ["bs"], ["filltime", "timestamp"]],
  columns: {
    // Prefer Product (the root symbol, "ES") over Contract ("ESU6").
    symbol: ["product", "contract"],
    side: ["bs", "side"],
    quantity: ["filledqty", "fillqty", "qty"],
    price: ["avgfillprice", "avgprice", "price"],
    fees: [["commission"], ["fees"]],
    timestamp: ["filltime", "timestamp"],
    date: ["date"],
    time: ["filltime"],
  },
  rowFilter: (row) => !("status" in row) || /filled/i.test(row["status"] ?? ""),
  normalizeSymbol: (symbol) => symbol.trim().toUpperCase(),
});

/**
 * TopstepX fills export. Real files (cross-checked against TradeNote's
 * community parser): AccountName, ContractName, ExecutePrice, FilledAt,
 * PositionDisposition (Opening/Closing), Side (Bid/Ask), Size, Status.
 */
export const topstepx = makeFillsFormat({
  id: "topstepx",
  label: "TopstepX (fills export)",
  required: [["contractname"], ["executeprice"], ["filledat"]],
  columns: {
    symbol: ["contractname"],
    side: ["side"], // "Bid" = buy, "Ask" = sell (handled by parseSide)
    quantity: ["size", "qty"],
    price: ["executeprice"],
    timestamp: ["filledat"],
  },
  rowFilter: (row) => !("status" in row) || /filled/i.test(row["status"] ?? ""),
});

/**
 * Interactive Brokers Flex Query export (distinct from the activity statement):
 * ClientAccountID, Symbol, Date/Time ("YYYYMMDD;HHmmss"), Buy/Sell, Quantity,
 * Price, Commission (negative), AssetClass, Code. Cross-checked against
 * TradeNote's community parser.
 */
export const ibkrFlex = makeFillsFormat({
  id: "ibkr-flex",
  label: "Interactive Brokers (Flex Query)",
  required: [["clientaccountid"], ["datetime"], ["buysell"]],
  columns: {
    symbol: ["symbol"],
    side: ["buysell"],
    quantity: ["quantity"],
    price: ["price", "tradeprice"],
    fees: [["commission", "ibcommission"]],
    timestamp: ["datetime"],
  },
});

/**
 * Webull orders export (only filled orders become executions). Two variants
 * exist in the wild: split columns (Filled, Avg Price, Filled Time) and
 * combined columns ("Filled/Total Qty", "Price/Avg Price") — both covered.
 */
export const webull = makeFillsFormat({
  id: "webull",
  label: "Webull (orders export)",
  required: [["symbol"], ["side"], ["status"], ["filled", "filledtotalqty"]],
  columns: {
    symbol: ["symbol"],
    side: ["side"],
    quantity: ["filled", "filledqty", "filledtotalqty"],
    price: ["avgprice", "averagefillprice", "priceavgprice", "price"],
    fees: [["commission"], ["fee"]],
    timestamp: ["filledtime", "timefilled", "placedtime", "time"],
  },
  rowFilter: (row) => /filled/i.test(row["status"] ?? ""),
});

/** DAS Trader Pro executions export. */
export const dastrader = makeFillsFormat({
  id: "das-trader",
  label: "DAS Trader Pro (executions export)",
  required: [["symb", "symbol"], ["bs", "side"], ["price"], ["time"]],
  columns: {
    symbol: ["symb", "symbol"],
    side: ["bs", "side"],
    quantity: ["qty", "shares"],
    price: ["price"],
    fees: [["commission"], ["ecnfee"], ["fee"]],
    date: ["date"],
    time: ["time"],
  },
});
