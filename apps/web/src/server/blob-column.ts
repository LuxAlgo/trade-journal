import { sql, type AnyColumn } from "drizzle-orm";

/**
 * Whether an image column holds one. `typeof` reads only the row header; `IS NOT NULL` loads
 * the whole image first.
 */
export const hasBlob = (column: AnyColumn) => sql<number>`typeof(${column}) <> 'null'`;
