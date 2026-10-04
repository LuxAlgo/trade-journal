import { it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  buildReviewPdf,
  cleanReviewLine,
  pdfFontFile,
  pngFontStack,
} from "../src/lib/export-review";
const font = readFileSync(new URL("../public/fonts/NotoSans-Regular.ttf", import.meta.url));
it("exports a paginated PDF with embedded Unicode text using the production builder", async () => {
  const bytes = await buildReviewPdf(
    {
      title: "Trade review · café",
      subtitle: "ES · 2026-09-02",
      lines: [
        "## Setup review",
        "**Plan followed**",
        ...Array.from(
          { length: 90 },
          (_, i) => `Observation ${i + 1}: planned risk 500 USD, realized 1.99R.`,
        ),
        "FINAL REVIEW LINE",
      ],
    },
    font,
  );
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBeGreaterThan(1);
  expect(doc.getTitle()).toBe("Trade review · café");
  if (process.env.JOURNAL_EXPORT_TEST_PATH)
    writeFileSync(process.env.JOURNAL_EXPORT_TEST_PATH, bytes);
});
it("reports unsupported glyphs rather than silently dropping note content", async () => {
  // The Latin font plus CJK note text keeps the missing-glyph check working:
  // CJK locales need their own verified font (docs/i18n.md §11).
  await expect(
    buildReviewPdf({ title: "Review", lines: ["交易日誌の盈虧 거래"] }, font),
  ).rejects.toThrow("does not support");
});
it("maps each locale to its bundled PDF font", () => {
  expect(pdfFontFile("en")).toBe("NotoSans-Regular.ttf");
  expect(pdfFontFile("es")).toBe("NotoSans-Regular.ttf");
  expect(pdfFontFile("fr")).toBe("NotoSans-Regular.ttf");
  expect(pdfFontFile("zh-CN")).toBe("NotoSansSC-Regular.otf");
  expect(pdfFontFile("zh-TW")).toBe("NotoSansTC-Regular.otf");
  expect(pdfFontFile("ja")).toBe("NotoSansJP-Regular.otf");
  expect(pdfFontFile("ko")).toBe("NotoSansKR-Regular.otf");
});
it("leads the PNG canvas stack with the bundled Noto family and real CJK system fonts", () => {
  expect(pngFontStack("ja")).toMatch(/^'Noto Sans JP',/);
  expect(pngFontStack("ja")).not.toContain("Arial");
  expect(pngFontStack("ko")).toMatch(/^'Noto Sans KR',/);
  expect(pngFontStack("zh-CN")).toMatch(/^'Noto Sans SC',/);
  expect(pngFontStack("zh-TW")).toMatch(/^'Noto Sans TC',/);
  // Latin locales keep their Arial fallback; it is never claimed to cover CJK.
  expect(pngFontStack("en")).toMatch(/^'Noto Sans', Arial/);
  expect(pngFontStack("es")).toMatch(/^'Noto Sans', Arial/);
  expect(pngFontStack("fr")).toMatch(/^'Noto Sans', Arial/);
});
it("embeds each locale's CJK font without dropping its representative glyphs", async () => {
  for (const [locale, sample, accented] of [
    ["zh-CN", "交易日志盈亏", "áéíóúüñç"],
    ["zh-TW", "交易日誌盈虧", "áéíóúüñç"],
    ["ja", "取引検証盈虧", "áéíóúüñç"],
    ["ko", "거래검증", "áéíóúüñç"],
  ] as const) {
    const cjkFont = readFileSync(
      new URL(`../public/fonts/${pdfFontFile(locale)}`, import.meta.url),
    );
    const bytes = await buildReviewPdf(
      { title: sample, subtitle: accented, lines: [sample] },
      cjkFont,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle(), locale).toBe(sample);
    expect(doc.getPageCount()).toBe(1);
  }
});
it("localizes the done checkbox label while keeping the structure", () => {
  expect(cleanReviewLine("- [x] Followed the plan", "[done]")).toBe("[done] Followed the plan");
  expect(cleanReviewLine("- [X] 複盤した", "[完了]")).toBe("[完了] 複盤した");
  expect(cleanReviewLine("- [x] 按计划执行", "[已完成]")).toBe("[已完成] 按计划执行");
  expect(cleanReviewLine("- [ ] Not done yet", "[done]")).toBe("[ ] Not done yet");
});
