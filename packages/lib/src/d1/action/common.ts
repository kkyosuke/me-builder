import { eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { D1Client } from "../client";

export type TableWithBaseSchema = SQLiteTable & {
  id: SQLiteColumn;
  isDeleted: SQLiteColumn;
  deletedAt: SQLiteColumn;
  updatedAt: SQLiteColumn;
};

/**
 * Soft deletes a record by ID in any D1 table containing baseSchema columns.
 * Sets isDeleted = true, deletedAt = now, and updatedAt = now.
 */
export async function softDelete<T extends TableWithBaseSchema>(
  db: D1Client,
  table: T,
  id: string,
) {
  const now = new Date();
  return db
    .update(table)
    .set({
      isDeleted: true,
      deletedAt: now,
      updatedAt: now,
    } as unknown as Record<string, unknown>)
    .where(eq(table.id, id));
}
