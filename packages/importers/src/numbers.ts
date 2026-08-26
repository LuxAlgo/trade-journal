/** "$1,234.56", "(45.20)", "1 234,56", "-12.5" → number. NaN when unparseable. */
export const parseMoney = (value: string | undefined): number => {
  if (value === undefined) return NaN;
  let text = value.trim();
  if (text === "") return NaN;
  // Combined value columns (Webull's "Price/Avg Price" → "185.50/186.00"):
  // the average fill price is the second segment.
  const combined = text.match(/^(-?[\d.,]+)\/(-?[\d.,]+)$/);
  if (combined) text = combined[2]!;
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  text = text.replace(/[()$€£\s]/g, "").replace(/^-/, "");
  // European decimal comma: "1.234,56" → "1234.56"; plain "12,5" → "12.5".
  if (/,\d{1,2}$/.test(text) && !/\.\d+$/.test(text)) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else {
    text = text.replace(/,/g, "");
  }
  const parsed = Number(text);
  if (Number.isNaN(parsed)) return NaN;
  return negative ? -parsed : parsed;
};

export const parseQuantity = (value: string | undefined): number => {
  if (value === undefined) return NaN;
  let text = value.trim();
  // Combined quantity columns (Webull's "Filled/Total Qty" → "5/10"):
  // the FILLED amount is the first segment.
  const combined = text.match(/^(-?[\d.,]+)\/(-?[\d.,]+)$/);
  if (combined) text = combined[1]!;
  const parsed = parseMoney(text);
  return Number.isNaN(parsed) ? NaN : Math.abs(parsed);
};
