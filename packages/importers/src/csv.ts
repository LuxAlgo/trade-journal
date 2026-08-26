/** Minimal RFC 4180 CSV parser — quotes, escaped quotes, embedded newlines,
 * comma/semicolon/tab delimiters. No dependency, no streaming (statements are small). */

export const detectDelimiter = (line: string): string => {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const delimiter of candidates) {
    const count = line.split(delimiter).length;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
};

export const parseCsv = (content: string, delimiter?: string): string[][] => {
  const text = content.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const sep = delimiter ?? detectDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === sep) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
};

/** Case/space/punctuation-insensitive header key: "Fill Price ($)" → "fillprice". */
export const headerKey = (header: string): string => header.toLowerCase().replace(/[^a-z0-9]/g, "");

export type Row = Record<string, string>;

/** Zip a header row and data rows into keyed records. */
export const toRecords = (rows: string[][]): Row[] => {
  const [header, ...data] = rows;
  if (!header) return [];
  const keys = header.map(headerKey);
  return data.map((cells) => {
    const record: Row = {};
    keys.forEach((key, index) => {
      if (key) record[key] = (cells[index] ?? "").trim();
    });
    return record;
  });
};

/** First non-empty value among alias keys (aliases already in headerKey form). */
export const pick = (row: Row, aliases: string[]): string | undefined => {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
};

export const hasHeaders = (headers: string[], required: string[][]): boolean => {
  const keys = new Set(headers.map(headerKey));
  return required.every((aliases) => aliases.some((alias) => keys.has(alias)));
};
