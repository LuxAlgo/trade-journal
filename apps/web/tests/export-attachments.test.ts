import { describe, it, expect } from "vitest";
import { attachmentExportRecord, EXPORT_ATTACHMENTS_NOTE } from "../src/lib/export-format";

describe("the JSON export stays small enough to build in memory", () => {
  it("lists attachment metadata without embedding the file contents", () => {
    const row = {
      id: "a1",
      ownerType: "trade",
      ownerId: "t1",
      name: "chart.png",
      mime: "image/png",
      size: 8 * 1024 * 1024,
      createdAt: "2026-09-01T00:00:00Z",
      data: Buffer.alloc(16, 1),
    };
    const exported: unknown = attachmentExportRecord(row);
    expect(exported).toEqual({
      id: "a1",
      ownerType: "trade",
      ownerId: "t1",
      name: "chart.png",
      mime: "image/png",
      size: 8 * 1024 * 1024,
      createdAt: "2026-09-01T00:00:00Z",
    });
    expect(exported).not.toHaveProperty("data");
    expect(exported).not.toHaveProperty("dataBase64");
  });

  it("tells the reader that attachment binaries live in the data directory", () => {
    expect(EXPORT_ATTACHMENTS_NOTE).toMatch(/data directory/);
    expect(EXPORT_ATTACHMENTS_NOTE).toMatch(/metadata/);
  });
});
