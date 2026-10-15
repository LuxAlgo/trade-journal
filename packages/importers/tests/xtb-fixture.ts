/**
 * Synthetic XTB xStation workbooks for tests. The XML mirrors real exports
 * (sheet order, preamble rows, numeric account and position ids, date cells
 * as Excel serials with a date number format, shared empty strings), but every
 * value here is invented. No real account data is committed.
 */
import { crc32, deflateRawSync } from "node:zlib";

type Cell = string | number | Date | null;
interface Sheet {
  name: string;
  rows: Cell[][];
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const column = (index: number): string =>
  index < 26
    ? String.fromCharCode(65 + index)
    : column(Math.floor(index / 26) - 1) + column(index % 26);

const sheetXml = (rows: Cell[][], strings: Map<string, number>): string => {
  const shared = (text: string) => {
    if (!strings.has(text)) strings.set(text, strings.size);
    return strings.get(text)!;
  };
  const body = rows
    .map((cells, r) => {
      const xml = cells
        .map((cell, c) => {
          const ref = `${column(c)}${r + 1}`;
          if (cell === null) return "";
          if (cell instanceof Date)
            return `<c r="${ref}" s="2"><v>${(cell.getTime() - EXCEL_EPOCH) / 86_400_000}</v></c>`;
          if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
          return `<c r="${ref}" t="s"><v>${shared(cell)}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}" spans="1:${cells.length}" x14ac:dyDescent="0.55">${xml}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"><sheetData>${body}</sheetData></worksheet>`;
};

/** A minimal but valid .xlsx package; `stored` skips compression. */
export const workbook = (sheets: Sheet[], options: { stored?: boolean } = {}): Uint8Array => {
  const strings = new Map<string, number>();
  const sheetParts = sheets.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    xml: sheetXml(sheet.rows, strings),
  }));
  const parts: { name: string; xml: string }[] = [
    {
      name: "[Content_Types].xml",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetParts.map((part) => `<Override PartName="/${part.name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${escape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    },
    ...sheetParts,
    {
      name: "xl/styles.xml",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/></numFmts><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    },
  ];
  parts.push({
    name: "xl/sharedStrings.xml",
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.size}" uniqueCount="${strings.size}">${[...strings.keys()].map((text) => `<si><t xml:space="preserve">${escape(text)}</t></si>`).join("")}</sst>`,
  });
  return zip(
    parts.map(({ name, xml }) => ({ name, data: Buffer.from(xml) })),
    options.stored,
  );
};

const zip = (files: { name: string; data: Buffer }[], stored = false): Uint8Array => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const body = stored ? file.data : deflateRawSync(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc32(file.data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(crc32(file.data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
};

const CLOSED_HEADER = [
  "Instrument",
  "Ticker",
  "Category",
  "Type",
  "Volume",
  "Open Price",
  "Open Time (UTC)",
  "Close Price",
  "Close Time (UTC)",
  "Product",
  "Profit/Loss",
  "Gross Profit",
  "Purchase Value",
  "Sale Value",
  "Stop Loss",
  "Take Profit",
  "Commission",
  "Margin",
  "Swap",
  "Rollover",
  "Open Conversion Rate",
  "Close Conversion Rate",
  "Close Origin",
  "Position ID",
  "Comment",
];
const CASH_HEADER = [
  "Type",
  "Instrument",
  "Ticker",
  "Category",
  "Time",
  "Amount",
  "ID",
  "Comment",
  "Product",
  "Position ID",
];
const OPEN_HEADER = [
  "Product",
  "Instrument/Position",
  "Ticker",
  "Category",
  "Type",
  "Volume",
  "Value",
  "Current price",
  "Open price",
  "Open time (UTC)",
  "Stop Loss",
  "Take Profit",
  "Net Profit %",
  "Net Profit",
  "Gross Profit",
  "Margin",
  "Open Commission",
  "Swap",
  "Rollover",
];

export interface ClosedLot {
  instrument: string;
  ticker: string;
  category: string;
  type: "BUY" | "SELL";
  volume: number;
  openPrice: number;
  openTime: Date;
  closePrice: number;
  closeTime: Date;
  net: number;
  gross: number;
  commission?: number;
  openRate?: number;
  closeRate?: number;
  positionId: number;
}
export interface OpenLot {
  instrument: string;
  ticker: string;
  category: string;
  type: "BUY" | "SELL";
  volume: number;
  openPrice: number;
  openTime: Date;
  positionId: number;
}
export interface CashOperation {
  type: string;
  time: Date;
  amount: number;
  id: number;
  comment: string;
  ticker?: string;
  positionId?: number;
}

/** One XTB account workbook: Closed Positions, Cash Operations, Open Positions. */
export const xtbWorkbook = (
  account: number,
  data: { closed?: ClosedLot[]; open?: OpenLot[]; cash?: CashOperation[] },
  options: { stored?: boolean } = {},
): Uint8Array => {
  const from = new Date("2026-09-01T21:00:00.000Z");
  const to = new Date("2026-10-08T08:00:00.000Z");
  const closed = data.closed ?? [];
  const open = data.open ?? [];
  const cash = data.cash ?? [];
  const preamble = (title: string): Cell[][] => [
    ["Account number", account],
    [title],
    ["Date from (UTC)", from],
    ["Date to (UTC)", to],
  ];
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const closedRows: Cell[][] = closed.map((lot) => [
    lot.instrument,
    lot.ticker,
    lot.category,
    lot.type,
    lot.volume,
    lot.openPrice,
    lot.openTime,
    lot.closePrice,
    lot.closeTime,
    "Investment Plans",
    lot.net,
    lot.gross,
    lot.volume * lot.openPrice * (lot.openRate ?? 1),
    lot.volume * lot.closePrice * (lot.closeRate ?? 1),
    "",
    "",
    lot.commission ?? 0,
    "",
    "",
    "",
    lot.openRate ?? 1,
    lot.closeRate ?? 1,
    "xStation5",
    lot.positionId,
    "",
  ]);
  const lotValue = (lot: OpenLot) => Number((lot.volume * lot.openPrice).toFixed(2));
  const openRows: Cell[][] = open.length
    ? [
        [
          "Investment Plan",
          open[0]!.instrument,
          open[0]!.ticker,
          open[0]!.category,
          "",
          sum(open.map((lot) => lot.volume)),
          sum(open.map(lotValue)),
          "",
          open[0]!.openPrice,
          "",
          "",
          "",
          0,
          0,
          0,
        ],
        ...open.map((lot): Cell[] => [
          "Investment Plan",
          lot.positionId,
          lot.ticker,
          "",
          lot.type,
          lot.volume,
          lotValue(lot),
          lot.openPrice,
          lot.openPrice,
          lot.openTime,
          "",
          "",
          0,
          0,
          0,
        ]),
      ]
    : [];
  return workbook(
    [
      {
        name: "Closed Positions",
        rows: [
          ...preamble("Closed Positions"),
          CLOSED_HEADER,
          ...closedRows,
          [
            "Profit/loss",
            ...Array<Cell>(9).fill(""),
            sum(closed.map((lot) => lot.net)),
            sum(closed.map((lot) => lot.gross)),
          ],
        ],
      },
      {
        name: "Cash Operations",
        rows: [
          ...preamble("Cash Operations"),
          CASH_HEADER,
          ...cash.map((operation): Cell[] => [
            operation.type,
            operation.ticker ? "Synthetic ETF" : "",
            operation.ticker ?? "",
            operation.ticker ? "ETF" : "",
            operation.time,
            operation.amount,
            operation.id,
            operation.comment,
            "My Trades",
            ...(operation.positionId ? [operation.positionId] : []),
          ]),
          ["Total", "", "", "", "", sum(cash.map((operation) => operation.amount))],
        ],
      },
      {
        name: "Open Positions",
        rows: [
          ["Account number", account],
          ["Open Positions"],
          ["Data as of report generated", to],
          ["Product", "Metric", "Amount", "Currency"],
          ["Investment Plans", "Open position value", sum(open.map(lotValue)), "EUR"],
          ["Investment Plans", "Open position profit", 0, "EUR"],
          ["Note", "Summary values and open positions are shown as of the report generation time"],
          OPEN_HEADER,
          ...openRows,
        ],
      },
    ],
    options,
  );
};
