/** Minimal .xlsx reader (ZIP + worksheet XML). No dependency; runs in Node and the browser. */

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

const u16 = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! | (bytes[offset + 1]! << 8);

const u32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)) >>>
  0;

const decodeXml = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const formatLooksLikeDate = (code: string): boolean => {
  const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  return /[ydhms]/i.test(stripped);
};

const excelSerialToIso = (serial: number, epochMs: number): string =>
  new Date(Math.round(epochMs + serial * 86_400_000)).toISOString();

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return "";
  const nearest = Math.round(value);
  // Position and account ids are large integers; Excel stores them as floats.
  if (Math.abs(value) >= 1e6 && Math.abs(value - nearest) < 1e-3) return String(nearest);
  const text = Object.is(value, -0) ? "0" : String(value);
  if (!/[eE]/.test(text)) return text;
  return value.toFixed(12).replace(/\.?0+$/, "");
};

const columnIndex = (cellRef: string): number => {
  const letters = /^[A-Z]+/i.exec(cellRef)?.[0] ?? "A";
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
};

const rowNumber = (cellRef: string): number => Number(/\d+$/.exec(cellRef)?.[0] ?? 0);

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  dataOffset: number;
}

const findEocd = (bytes: Uint8Array): number => {
  const start = Math.max(0, bytes.length - 22 - 65_535);
  for (let offset = bytes.length - 22; offset >= start; offset--) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    )
      return offset;
  }
  throw new Error("This file is not an .xlsx workbook.");
};

const zipEntries = (bytes: Uint8Array): ZipEntry[] => {
  const eocd = findEocd(bytes);
  const count = u16(bytes, eocd + 10);
  let cursor = u32(bytes, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (u32(bytes, cursor) !== 0x02014b50) throw new Error("This file is not an .xlsx workbook.");
    const method = u16(bytes, cursor + 10);
    const compressedSize = u32(bytes, cursor + 20);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = u16(bytes, localOffset + 26);
    const localExtraLength = u16(bytes, localOffset + 28);
    entries.push({
      name,
      method,
      compressedSize,
      dataOffset: localOffset + 30 + localNameLength + localExtraLength,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  if (data.length === 0) return new Uint8Array();
  const stream = new Blob([data.slice()])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const readEntry = async (bytes: Uint8Array, entry: ZipEntry): Promise<string> => {
  const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(compressed);
  if (entry.method === 8) return new TextDecoder().decode(await inflateRaw(compressed));
  throw new Error(`Unsupported Excel compression (method ${entry.method}).`);
};

const sharedStrings = (xml: string): string[] =>
  [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((text) => decodeXml(text[1]!))
      .join(""),
  );

const dateStyleIndexes = (xml: string): Set<number> => {
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g))
    custom.set(Number(match[1]), decodeXml(match[2]!));
  const block = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const indexes = new Set<number>();
  let style = 0;
  for (const match of block.matchAll(/<xf\b[^>]*numFmtId="(\d+)"/g)) {
    const id = Number(match[1]);
    const code = custom.get(id);
    if (BUILTIN_DATE_FORMATS.has(id) || (code !== undefined && formatLooksLikeDate(code)))
      indexes.add(style);
    style++;
  }
  return indexes;
};

const sheetRows = (
  xml: string,
  strings: string[],
  dates: Set<number>,
  epochMs: number,
): string[][] => {
  const cells = new Map<number, Map<number, string>>();
  let maxRow = 0;
  let maxColumn = 0;
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const ref = / r="([^"]+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    const row = rowNumber(ref);
    const column = columnIndex(ref);
    const type = / t="([^"]+)"/.exec(attrs)?.[1];
    const style = Number(/ s="(\d+)"/.exec(attrs)?.[1] ?? 0);
    const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
    const inline = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((text) => decodeXml(text[1]!))
      .join("");
    let value = "";
    if (type === "s" && raw !== undefined) value = strings[Number(raw)] ?? "";
    else if (type === "inlineStr" || type === "str") value = inline || (raw ? decodeXml(raw) : "");
    else if (raw !== undefined && raw !== "") {
      const number = Number(raw);
      value =
        dates.has(style) && Number.isFinite(number)
          ? excelSerialToIso(number, epochMs)
          : formatNumber(number);
    } else value = inline;
    if (!cells.has(row)) cells.set(row, new Map());
    cells.get(row)!.set(column, value);
    maxRow = Math.max(maxRow, row);
    maxColumn = Math.max(maxColumn, column);
  }
  const rows: string[][] = [];
  for (let row = 1; row <= maxRow; row++) {
    const line = cells.get(row);
    if (!line || [...line.values()].every((value) => value === "")) continue;
    const cellsInRow = Array.from({ length: maxColumn + 1 }, (_, index) => line.get(index) ?? "");
    while (cellsInRow.length > 0 && cellsInRow[cellsInRow.length - 1] === "") cellsInRow.pop();
    rows.push(cellsInRow);
  }
  return rows;
};

/** Read every worksheet. Dates become UTC ISO strings; other numbers stay plain decimals. */
export const readXlsx = async (data: ArrayBuffer | Uint8Array): Promise<XlsxSheet[]> => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new Error("This file is not an .xlsx workbook.");
  const entries = zipEntries(bytes);
  const byName = new Map(entries.map((entry) => [entry.name.replace(/\\/g, "/"), entry]));
  const read = async (name: string): Promise<string | null> => {
    const entry = byName.get(name) ?? byName.get(`xl/${name.replace(/^xl\//, "")}`);
    return entry ? readEntry(bytes, entry) : null;
  };
  const workbook = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("This file is not an .xlsx workbook.");
  const strings = sharedStrings((await read("xl/sharedStrings.xml")) ?? "");
  const dates = dateStyleIndexes((await read("xl/styles.xml")) ?? "");
  const epochMs = /date1904="(?:1|true)"/.test(workbook) ? Date.UTC(1904, 0, 1) : EXCEL_EPOCH_MS;
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[1]!)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(match[1]!)?.[1];
    if (id && target) targets.set(id, target);
  }
  const sheets: XlsxSheet[] = [];
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = /\bname="([^"]+)"/.exec(match[1]!)?.[1];
    const id = /\br:id="([^"]+)"/.exec(match[1]!)?.[1];
    const target = id ? targets.get(id) : undefined;
    if (!name || !target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\//, "")}`;
    const xml = await read(path);
    if (!xml) continue;
    sheets.push({ name: decodeXml(name), rows: sheetRows(xml, strings, dates, epochMs) });
  }
  if (sheets.length === 0) throw new Error("This workbook has no sheets.");
  return sheets;
};
