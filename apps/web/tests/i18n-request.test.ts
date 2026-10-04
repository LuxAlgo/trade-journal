import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Keep the real request-scoped modules out of the unit test runtime.
vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("cookies() is not available in unit tests");
  },
}));
vi.mock("next-intl/server", () => ({
  getRequestConfig: (fn: unknown) => fn,
}));

const { loadLocaleMessages, mergeLocaleMessages } = await import("../src/i18n/request");
const { resolveRequestedLocale } = await import("../src/i18n/config");

const makeFixture = (files: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), "i18n-messages-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(content));
  }
  return dir;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("locale message merger", () => {
  it("merges every namespace file of a locale directory", () => {
    const dir = makeFixture({
      "common.json": { common: { loading: { page: "Loading page…" } } },
      "metadata.json": { metadata: { description: "The open-source trade journal" } },
    });
    try {
      expect(mergeLocaleMessages(dir)).toEqual({
        common: { loading: { page: "Loading page…" } },
        metadata: { description: "The open-source trade journal" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws a path-bearing error when a top-level key does not match the file name", () => {
    const dir = makeFixture({
      "common.json": { wrong: { loading: { page: "x" } } },
    });
    try {
      expect(() => mergeLocaleMessages(dir)).toThrowError(/common\.json/);
      expect(() => mergeLocaleMessages(dir)).toThrowError(/"common"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects files without a single top-level namespace object", () => {
    const dir = makeFixture({ "metadata.json": ["not", "an", "object"] });
    try {
      expect(() => mergeLocaleMessages(dir)).toThrowError(/metadata\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads only the requested locale directory, never its siblings", () => {
    const root = mkdtempSync(join(tmpdir(), "i18n-root-"));
    const en = join(root, "en");
    const fr = join(root, "fr");
    mkdirSync(en, { recursive: true });
    mkdirSync(fr, { recursive: true });
    writeFileSync(join(en, "common.json"), JSON.stringify({ common: { ok: true } }));
    writeFileSync(join(fr, "common.json"), JSON.stringify({ broken: true }));
    try {
      expect(mergeLocaleMessages(en)).toEqual({ common: { ok: true } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails with the searched paths when the messages root is missing", () => {
    const originalCwd = process.cwd;
    process.cwd = () => join(originalCwd(), "definitely-missing");
    try {
      expect(() => loadLocaleMessages("en")).toThrowError(/Messages directory not found/);
    } finally {
      process.cwd = originalCwd;
    }
  });
});

describe("cookie fallback", () => {
  it("falls back to the default locale outside the enum", () => {
    expect(resolveRequestedLocale(undefined)).toBe("en");
    expect(resolveRequestedLocale("attacker-controlled")).toBe("en");
  });
});
