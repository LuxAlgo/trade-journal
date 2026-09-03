/** Attachment fields included in the JSON export. Binaries stay on disk. */
export interface ExportedAttachment {
  id: string;
  ownerType: string;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export const EXPORT_ATTACHMENTS_NOTE =
  "Attachments are listed as metadata only. Their binary contents live in the data directory (JOURNAL_DATA_DIR, default ./data), which remains the complete backup.";

/**
 * Strip attachment binaries from an export row. Embedding every file (up to
 * 8 MB each) as base64 in one in-memory JSON document can exhaust memory, so
 * the export carries metadata only.
 */
export const attachmentExportRecord = (row: {
  id: string;
  ownerType: string;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}): ExportedAttachment => ({
  id: row.id,
  ownerType: row.ownerType,
  ownerId: row.ownerId,
  name: row.name,
  mime: row.mime,
  size: row.size,
  createdAt: row.createdAt,
});
