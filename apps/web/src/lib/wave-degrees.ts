/**
 * Elliott wave degrees: the same count labelled for its size, so a Primary wave reads ①②③
 * and the Intermediate waves inside it read (1)(2)(3). The degree is a setting of the
 * Elliott tools (in the drawing's settings and in templates); "none" keeps plain labels.
 */

export const WAVE_DEGREES = [
  { value: "", label: "None" },
  { value: "grand-supercycle", label: "Grand supercycle ((I))" },
  { value: "supercycle", label: "Supercycle (I)" },
  { value: "cycle", label: "Cycle I" },
  { value: "primary", label: "Primary ①" },
  { value: "intermediate", label: "Intermediate (1)" },
  { value: "minor", label: "Minor 1" },
  { value: "minute", label: "Minute (i)" },
  { value: "minuette", label: "Minuette i" },
  { value: "subminuette", label: "Subminuette [i]" },
] as const;

export type WaveDegree = Exclude<(typeof WAVE_DEGREES)[number]["value"], "">;

export const isWaveDegree = (value: unknown): value is WaveDegree =>
  typeof value === "string" && value !== "" && WAVE_DEGREES.some((d) => d.value === value);

const ROMAN = ["0", "I", "II", "III", "IV", "V"];
const CIRCLED_DIGITS = ["⓪", "①", "②", "③", "④", "⑤"];
const CIRCLED_LETTERS: Record<string, string> = { A: "Ⓐ", B: "Ⓑ", C: "Ⓒ" };

/** One point label in a degree's notation: "3" → "(iii)" for Minute, "B" → "Ⓑ" for Primary. */
export function degreeLabel(label: string, degree: WaveDegree | undefined): string {
  if (!degree) return label;
  const digit = /^[0-5]$/.test(label) ? Number(label) : null;
  const letter = /^[ABC]$/.test(label) ? label : null;
  if (digit === null && !letter) return label;
  const upper = digit !== null ? ROMAN[digit]! : letter!;
  const lower = upper === "0" ? "0" : upper.toLowerCase();
  switch (degree) {
    case "grand-supercycle":
      return `((${upper}))`;
    case "supercycle":
      return `(${upper})`;
    case "cycle":
      return upper;
    case "primary":
      return digit !== null ? CIRCLED_DIGITS[digit]! : CIRCLED_LETTERS[letter!]!;
    case "intermediate":
      return `(${label})`;
    case "minor":
      return label;
    case "minute":
      return `(${lower})`;
    case "minuette":
      return lower;
    case "subminuette":
      return `[${lower}]`;
  }
}
