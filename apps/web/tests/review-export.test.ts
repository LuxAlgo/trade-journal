import { it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildReviewPdf } from "../src/lib/export-review";
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
  await expect(buildReviewPdf({ title: "Review", lines: ["🚀"] }, font)).rejects.toThrow(
    "does not support",
  );
});
