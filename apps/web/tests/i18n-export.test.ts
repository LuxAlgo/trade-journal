// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMessages, renderWithLocale } from "./helpers/i18n";
import { locales } from "../src/i18n/config";
import { ReviewExport } from "../src/components/review-export";
import { EXPORT_ATTACHMENTS_NOTE } from "../src/lib/export-format";

/**
 * The review-export lib is doubled so component tests can drive both failure
 * modes (localized ExportError paths) and the success path (dialog, download
 * links, preview note) without a real canvas or font download (T34).
 */
const mocks = vi.hoisted(() => ({
  mode: "reject-coded" as "reject-coded" | "reject-raw" | "resolve",
}));
vi.mock("@/lib/export-review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export-review")>();
  const pdfResult = () => [
    { blob: new Blob(["%PDF-fixture"], { type: "application/pdf" }), filename: "review.pdf" },
  ];
  const pngResult = () => [
    { blob: new Blob(["png"], { type: "image/png" }), filename: "review.png" },
  ];
  return {
    ...actual,
    exportPdf: () => {
      if (mocks.mode === "resolve") return Promise.resolve(pdfResult());
      if (mocks.mode === "reject-raw") return Promise.reject(new Error("Network down"));
      return Promise.reject(new actual.ExportError("font-load", "Could not load the PDF font."));
    },
    exportPng: () => {
      if (mocks.mode === "resolve") return Promise.resolve(pngResult());
      return Promise.reject(
        new actual.ExportError("png-unavailable", "Image export is unavailable in this browser."),
      );
    },
  };
});

interface ExportMessages {
  exportPdf: string;
  exportPng: string;
  privacyHint: string;
  dialogTitle: string;
  download: string;
  downloadIndexed: string;
  pdfPreviewNote: string;
  pngAlt: string;
  doneLabel: string;
  error: Record<string, string>;
}
const exportMessages = (locale: string): ExportMessages =>
  (loadMessages(locale) as Record<string, unknown>)["export"] as ExportMessages;

const renderExport = (locale: string) =>
  renderWithLocale(
    createElement(ReviewExport, {
      document: { title: "Review", subtitle: "S", lines: ["- [x] done"] },
    }),
    { locale },
  );

const buttonByLabel = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === label);

const click = async (button: HTMLElement) => {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const alertText = () => document.body.querySelector<HTMLElement>('[role="alert"]')?.textContent;

beforeAll(() => {
  // jsdom has no blob URL store; the component only round-trips what we hand it.
  (URL as unknown as Record<string, unknown>).createObjectURL ??= () => "blob:fixture";
  (URL as unknown as Record<string, unknown>).revokeObjectURL ??= () => {};
});

describe("review export copy in the seven locales (T34)", () => {
  it("renders the export buttons with each locale's own labels", () => {
    for (const locale of locales) {
      const m = exportMessages(locale);
      const { container, unmount } = renderExport(locale);
      const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
      expect(labels, locale).toContain(m.exportPdf);
      expect(labels, locale).toContain(m.exportPng);
      unmount();
      document.body.innerHTML = "";
    }
  });

  it("shows the localized dialog title, download links, preview note and PNG alt", async () => {
    mocks.mode = "resolve";
    try {
      for (const locale of locales) {
        const m = exportMessages(locale);
        const { container, unmount } = renderExport(locale);
        await click(buttonByLabel(container, m.exportPdf)!);
        expect(document.body.textContent, locale).toContain(m.dialogTitle);
        expect(document.body.textContent, locale).toContain(m.download.replace("{format}", "PDF"));
        expect(document.body.textContent, locale).toContain(m.pdfPreviewNote);
        await click(buttonByLabel(container, m.exportPng)!);
        expect(document.body.textContent, locale).toContain(m.download.replace("{format}", "PNG"));
        const img = document.body.querySelector("img");
        expect(img?.getAttribute("alt"), locale).toBe(m.pngAlt);
        unmount();
        document.body.innerHTML = "";
      }
    } finally {
      mocks.mode = "reject-coded";
    }
  });

  it("localizes export failures by code and keeps raw error messages verbatim", async () => {
    for (const locale of locales) {
      const m = exportMessages(locale);
      const { container, unmount } = renderExport(locale);
      await click(buttonByLabel(container, m.exportPdf)!);
      expect(alertText(), `${locale} font-load`).toBe(m.error.fontLoad);
      await click(buttonByLabel(container, m.exportPng)!);
      expect(alertText(), `${locale} png-unavailable`).toBe(m.error.pngUnavailable);
      unmount();
      document.body.innerHTML = "";
    }
    // Unknown/third-party errors keep their original message (docs/i18n.md §6).
    mocks.mode = "reject-raw";
    try {
      const { container, unmount } = renderExport("ja");
      await click(buttonByLabel(container, exportMessages("ja").exportPdf)!);
      expect(alertText()).toBe("Network down");
      unmount();
    } finally {
      mocks.mode = "reject-coded";
      document.body.innerHTML = "";
    }
  });
});

describe("bundled export fonts (T34)", () => {
  const fontsDir = [
    join(process.cwd(), "apps", "web", "public", "fonts"),
    join(process.cwd(), "public", "fonts"),
  ].find((dir) => existsSync(join(dir, "NotoSans-Regular.ttf")));
  const cjkFontFiles: Record<string, string> = {
    "zh-CN": "NotoSansSC-Regular.otf",
    "zh-TW": "NotoSansTC-Regular.otf",
    ja: "NotoSansJP-Regular.otf",
    ko: "NotoSansKR-Regular.otf",
  };
  const representative: Record<string, string> = {
    "zh-CN": "交易日志盈亏",
    "zh-TW": "交易日誌盈虧",
    ja: "取引検証盈虧",
    ko: "거래검증",
  };
  const missing = Object.values(cjkFontFiles).filter(
    (file) => !fontsDir || !existsSync(join(fontsDir, file)),
  );
  if (missing.length)
    console.warn(
      `[T34 pending] CJK fonts not bundled (${missing.join(", ")}). Source: https://github.com/notofonts/noto-cjk Sans/SubsetOTF, SIL OFL 1.1. PDF exports for these locales keep the existing missing-glyph error until then.`,
    );

  it.skipIf(missing.length > 0)(
    "covers each CJK locale's representative glyphs with the bundled font",
    async () => {
      const { default: fontkit } = await import("@pdf-lib/fontkit");
      for (const [locale, file] of Object.entries(cjkFontFiles)) {
        const font = fontkit.create(readFileSync(join(fontsDir!, file)));
        const sample = representative[locale]! + "áéíóúüñç";
        for (const char of new Set(sample)) {
          expect(
            font.hasGlyphForCodePoint(char.codePointAt(0)!),
            `${locale} font ${file} missing glyph ${char}`,
          ).toBe(true);
        }
      }
      // SIL OFL 1.1 license ships next to the fonts.
      const license = readFileSync(join(fontsDir!, "LICENSE-OFL.txt"), "utf8");
      expect(license).toMatch(/Open Font License/);
      expect(license).toMatch(/Noto/);
    },
  );
});

/**
 * Machine contract (docs/i18n.md §12, T35): the CSV/JSON export is byte- and
 * structure-identical across the seven interface languages; the NEXT_LOCALE
 * cookie never enters the export data. route.ts is exercised as-is.
 */
const originalDataDir = process.env.JOURNAL_DATA_DIR;
const originalPassword = process.env.JOURNAL_PASSWORD;
const scratch = mkdtempSync(join(tmpdir(), "journal-export-i18n-"));
process.env.JOURNAL_DATA_DIR = scratch;
process.env.JOURNAL_PASSWORD = "";
const { db, accounts } = await import("../src/db");
const { insertExecutions } = await import("../src/server/executions");
const { rebuildAccount } = await import("../src/server/rebuild");
const { GET } = await import("../src/app/api/export/route");

const exportRequest = (locale: string, format?: string) =>
  GET(
    new Request(`http://localhost/api/export${format ? `?format=${format}` : ""}`, {
      headers: { cookie: `NEXT_LOCALE=${locale}` },
    }),
  );

const CSV_HEADER =
  "key,account_id,symbol,direction,status,opened_at,closed_at,quantity,avg_entry,avg_exit,gross_pnl,fees,net_pnl,tags,notes";
const JSON_KEYS = [
  "accounts",
  "attachments",
  "executions",
  "exportedAt",
  "folders",
  "importBatches",
  "importSourceAliases",
  "importSources",
  "journalDays",
  "journalDefaults",
  "missedTrades",
  "note",
  "noteTemplates",
  "notes",
  "playbooks",
  "progressChecks",
  "progressRules",
  "propAccounts",
  "propAudit",
  "propEntries",
  "propReceipts",
  "settings",
  "trades",
  "tradeRuleChecks",
].sort();

beforeAll(() => {
  db.insert(accounts)
    .values({ id: "fixture", name: "Fixture Account", kind: "manual", createdAt: "2026-01-01" })
    .run();
  insertExecutions(
    "fixture",
    [
      {
        symbol: "TEST",
        side: "buy",
        quantity: 10,
        price: 100,
        fee: 1,
        executedAt: "2026-09-01T10:00:00Z",
      },
      {
        symbol: "TEST",
        side: "sell",
        quantity: 10,
        price: 102.5,
        fee: 1,
        executedAt: "2026-09-01T11:00:00Z",
      },
    ],
    "manual",
  );
  insertExecutions(
    "fixture",
    [
      {
        symbol: "NOTE2",
        side: "buy",
        quantity: 2,
        price: 50,
        fee: 0,
        executedAt: "2026-09-02T10:00:00Z",
      },
      {
        symbol: "NOTE2",
        side: "sell",
        quantity: 2,
        price: 55,
        fee: 0,
        executedAt: "2026-09-02T11:00:00Z",
      },
    ],
    "manual",
    'Plan, "A" stage — 復盤',
  );
  rebuildAccount("fixture");
});

afterAll(() => {
  db.$client.close();
  if (originalDataDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDataDir;
  if (originalPassword === undefined) delete process.env.JOURNAL_PASSWORD;
  else process.env.JOURNAL_PASSWORD = originalPassword;
  rmSync(scratch, { recursive: true, force: true });
});

describe("export machine contract vs. interface language (T35)", () => {
  it("produces a byte-identical CSV for the same data in all seven locales", async () => {
    const bodies: string[] = [];
    for (const locale of locales) {
      const response = await exportRequest(locale, "csv");
      expect(response.status, locale).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/csv");
      bodies.push(await response.text());
    }
    expect(bodies[0]!.split("\n")[0]).toBe(CSV_HEADER);
    expect(bodies[0]!.trimEnd().split("\n")).toHaveLength(3); // header + 2 trades
    expect(new Set(bodies).size, "CSV output must not vary with NEXT_LOCALE").toBe(1);
  });

  it("keeps the JSON export structurally identical and free of the locale cookie", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-01-02T03:04:05Z") });
    try {
      const bodies: Record<string, Record<string, unknown>> = {};
      for (const locale of locales) {
        const response = await exportRequest(locale);
        expect(response.status, locale).toBe(200);
        bodies[locale] = (await response.json()) as Record<string, unknown>;
      }
      // exportedAt is mocked so even naturally varying fields match exactly.
      expect(bodies.en!.exportedAt).toBe("2026-01-02T03:04:05.000Z");
      // EXPORT_ATTACHMENTS_NOTE stays English machine data in every locale.
      expect(bodies.en!.note).toBe(EXPORT_ATTACHMENTS_NOTE);
      expect(Object.keys(bodies.en!).sort()).toEqual(JSON_KEYS);
      const baseline = { ...bodies.en! };
      delete baseline.exportedAt;
      for (const locale of locales) {
        const body = { ...bodies[locale]! };
        delete body.exportedAt;
        expect(body, `JSON export differs for locale ${locale}`).toEqual(baseline);
      }
      expect(JSON.stringify(bodies)).not.toContain("NEXT_LOCALE");
      expect(JSON.stringify(bodies)).not.toContain('"locale"');
    } finally {
      vi.useRealTimers();
    }
  });
});
