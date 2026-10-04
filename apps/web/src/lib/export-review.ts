import { readVizTokens } from "@/components/charts/tokens";
import type { Locale } from "@/i18n/config";

export interface ReviewDocument {
  title: string;
  subtitle?: string;
  lines: string[];
}
export interface ExportFile {
  blob: Blob;
  filename: string;
}
const filename = (title: string) =>
  title.replace(/[^a-z0-9_-]/gi, "-").slice(0, 100) || "journal-review";

/**
 * Closed set of export failure codes (docs/i18n.md §11, T34). Each code has an
 * `export.error.<camelCase>` message key per locale; the English copy thrown
 * with the error stays the machine-stable fallback (tests and log readers
 * keep seeing the original text).
 */
export const exportErrorCodes = [
  "font-load",
  "missing-glyphs",
  "png-unavailable",
  "png-failed",
] as const;
export type ExportErrorCode = (typeof exportErrorCodes)[number];

/** Error with a stable code next to the human-readable English fallback copy. */
export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string,
    readonly params?: Record<string, string>,
  ) {
    super(message);
  }
}

/** `export.error.<camelCase>` key for a failure code (matches message files). */
export const exportErrorKey = (code: ExportErrorCode): string =>
  `error.${code.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}`;

/**
 * Embedded PDF font per interface language (docs/i18n.md §11). Latin locales
 * keep the original font; CJK locales use the Google Noto Sans subset whose
 * glyph coverage is verified in tests before shipping (SIL OFL 1.1, license
 * files live next to the fonts).
 */
const pdfFontFiles: Record<Locale, string> = {
  en: "NotoSans-Regular.ttf",
  "zh-CN": "NotoSansSC-Regular.otf",
  ja: "NotoSansJP-Regular.otf",
  ko: "NotoSansKR-Regular.otf",
  "zh-TW": "NotoSansTC-Regular.otf",
  es: "NotoSans-Regular.ttf",
  fr: "NotoSans-Regular.ttf",
};
export const pdfFontFile = (locale: Locale): string => pdfFontFiles[locale];

/**
 * Canvas font stack for PNG reviews: the bundled Noto family first, then real
 * system CJK fonts per language. Arial is never claimed to cover CJK — it only
 * remains a Latin fallback for the Latin locales.
 */
const pngFontStacks: Record<Locale, string> = {
  en: "'Noto Sans', Arial, sans-serif",
  "zh-CN": "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  ja: "'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Meiryo', sans-serif",
  ko: "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  "zh-TW": "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif",
  es: "'Noto Sans', Arial, sans-serif",
  fr: "'Noto Sans', Arial, sans-serif",
};
export const pngFontStack = (locale: Locale): string => pngFontStacks[locale];

/** The bundled font file each PNG stack's first family maps to. */
const bundledWebFonts: Record<Locale, { family: string; file: string }> = {
  en: { family: "Noto Sans", file: "NotoSans-Regular.ttf" },
  "zh-CN": { family: "Noto Sans SC", file: "NotoSansSC-Regular.otf" },
  ja: { family: "Noto Sans JP", file: "NotoSansJP-Regular.otf" },
  ko: { family: "Noto Sans KR", file: "NotoSansKR-Regular.otf" },
  "zh-TW": { family: "Noto Sans TC", file: "NotoSansTC-Regular.otf" },
  es: { family: "Noto Sans", file: "NotoSans-Regular.ttf" },
  fr: { family: "Noto Sans", file: "NotoSans-Regular.ttf" },
};

// Load each bundled font once per browser session; a failed load falls back
// to the rest of the stack instead of blocking the export.
const loadedFaces = new Map<string, Promise<void>>();
const ensureBundledFont = (locale: Locale): Promise<void> => {
  const font = bundledWebFonts[locale];
  if (typeof FontFace === "undefined" || typeof document === "undefined") return Promise.resolve();
  let pending = loadedFaces.get(font.family);
  if (!pending) {
    pending = new FontFace(font.family, `url(/fonts/${font.file})`)
      .load()
      .then((face) => {
        document.fonts.add(face);
      })
      .catch(() => {
        // The system fonts in the stack still render the review.
      });
    loadedFaces.set(font.family, pending);
  }
  return pending;
};

/** Strip Markdown decorations; `- [x]` checkboxes carry the localized done label. */
export const cleanReviewLine = (line: string, doneLabel: string): string =>
  line
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^- \[x\]/gi, doneLabel)
    .replace(/^- \[ \]/g, "[ ]");

export async function buildReviewPdf(
  doc: ReviewDocument,
  fontBytes: ArrayBuffer | Uint8Array,
  { doneLabel = "[done]" }: { doneLabel?: string } = {},
) {
  const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const allText = [doc.title, doc.subtitle ?? "", ...doc.lines].join("\n");
  const missing = [
    ...new Set([...allText].filter((c) => !/\s/.test(c) && !supported.has(c.codePointAt(0)!))),
  ];
  if (missing.length)
    throw new ExportError(
      "missing-glyphs",
      `PDF font does not support these characters: ${missing.slice(0, 8).join(" ")}. Remove them for this export, or export a PNG review.`,
      { chars: missing.slice(0, 8).join(" ") },
    );
  pdf.setTitle(doc.title);
  pdf.setCreator("Trade Journal");
  let page = pdf.addPage([595, 842]),
    y = 786;
  const addPage = () => {
    page = pdf.addPage([595, 842]);
    y = 786;
  };
  const draw = (text: string, size: number, color = rgb(0.16, 0.19, 0.24)) => {
    const max = 499;
    let line = "";
    // Character wrapping also handles URLs and long unbroken symbols.
    for (const char of text) {
      if (font.widthOfTextAtSize(line + char, size) > max && line) {
        if (y < 65) addPage();
        page.drawText(line, { x: 48, y, size, font, color });
        y -= size * 1.55;
        line = "";
      }
      line += char === "\t" ? "  " : char;
    }
    if (y < 65) addPage();
    page.drawText(line || " ", { x: 48, y, size, font, color });
    y -= size * 1.55;
  };
  draw(doc.title, 22);
  if (doc.subtitle) draw(doc.subtitle, 10, rgb(0.4, 0.44, 0.5));
  y -= 14;
  for (const line of doc.lines.flatMap((s) => s.split("\n"))) {
    const heading = /^#{1,6}\s/.test(line);
    draw(cleanReviewLine(line, doneLabel), heading ? 14 : 10);
    if (heading) y -= 4;
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Trade Journal  |  ${i + 1} / ${pages.length}`, {
      x: 48,
      y: 30,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    }),
  );
  return new Uint8Array(await pdf.save());
}
export async function exportPdf(doc: ReviewDocument, locale: Locale, doneLabel = "[done]") {
  const response = await fetch(`/fonts/${pdfFontFile(locale)}`);
  if (!response.ok) throw new ExportError("font-load", "Could not load the PDF font.");
  const bytes = await buildReviewPdf(doc, await response.arrayBuffer(), {
    doneLabel,
  });
  return [
    {
      blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      filename: `${filename(doc.title)}.pdf`,
    },
  ];
}

export async function exportPng(doc: ReviewDocument, locale: Locale) {
  await document.fonts.ready;
  await ensureBundledFont(locale);
  // Colors come from the same resolved design tokens the charts paint with,
  // so an exported card matches the active theme.
  const t = readVizTokens();
  const stack = pngFontStack(locale);
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  if (!ctx)
    throw new ExportError("png-unavailable", "Image export is unavailable in this browser.");
  const setFont = (weight: string, size: number) => {
    ctx.font = `${weight}${weight ? " " : ""}${size}px ${stack}`;
  };
  canvas.width = 1200;
  setFont("", 24);
  const lines: string[] = [];
  for (const source of doc.lines.flatMap((s) => s.split("\n"))) {
    let line = "";
    for (const char of source) {
      if (ctx.measureText(line + char).width > 1040 && line) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
  }
  const pages = Math.max(1, Math.ceil(lines.length / 55));
  const files: ExportFile[] = [];
  // A long review is exported as numbered cards, without clipping its content.
  for (let i = 0; i < pages; i++) {
    const chunk = lines.slice(i * 55, (i + 1) * 55);
    canvas.height = Math.max(600, 300 + chunk.length * 38);
    ctx.fillStyle = t.surface;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = t.brand;
    ctx.fillRect(0, 0, 1200, 8);
    ctx.fillStyle = t.inkMuted;
    setFont("", 22);
    ctx.fillText(`TRADE JOURNAL${pages > 1 ? ` · ${i + 1}/${pages}` : ""}`, 80, 70);
    ctx.fillStyle = t.foreground;
    setFont("bold", 38);
    ctx.fillText(doc.title, 80, 130, 1040);
    ctx.fillStyle = t.inkMuted;
    setFont("", 20);
    ctx.fillText(doc.subtitle ?? "", 80, 174, 1040);
    ctx.fillStyle = t.foreground;
    setFont("", 24);
    chunk.forEach((line, j) => ctx.fillText(line, 80, 244 + j * 38));
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new ExportError("png-failed", "Image export failed."))),
        "image/png",
      ),
    );
    files.push({ blob, filename: `${filename(doc.title)}${pages > 1 ? `-${i + 1}` : ""}.png` });
  }
  return files;
}
