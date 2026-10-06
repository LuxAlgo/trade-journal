/**
 * Lessons written in day notes: the "**Keep**" and "**Fix**" lists AI recaps end with (and
 * that you can edit or write yourself). Read from the note, not from the model's answer, so
 * only what you kept counts.
 */

export interface DayLessons {
  keep: string[];
  fix: string[];
}

const HEADING = /^\s*(?:#{1,6}\s*)?\*{0,2}\s*(keep|fix)\s*\*{0,2}\s*:?\s*\*{0,2}\s*$/i;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/;

/** Every Keep and Fix item in a note, in order, without duplicates. */
export function lessonsFrom(markdown: string): DayLessons {
  const out: DayLessons = { keep: [], fix: [] };
  let section: keyof DayLessons | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(HEADING);
    if (heading) {
      section = heading[1]!.toLowerCase() as keyof DayLessons;
      continue;
    }
    const item = line.match(ITEM);
    if (section && item) {
      const text = item[1]!.replace(/\*\*/g, "").trim();
      if (text && !out[section].includes(text)) out[section].push(text);
      continue;
    }
    // A blank line inside a list is fine; any other text ends the list.
    if (line.trim()) section = null;
  }
  return out;
}

/** The seven journal days ending on `end` ("YYYY-MM-DD"), oldest first. */
export function weekEnding(end: string): string[] {
  const [y, m, d] = end.split("-").map(Number) as [number, number, number];
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d - 6 + i)).toISOString().slice(0, 10),
  );
}
