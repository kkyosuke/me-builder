import { and, eq } from "drizzle-orm";
import type { AccountDataDatabase } from "../database";
import { sourceRecords } from "../schema/source";

/** 本人に現在有効な入力記録が1件以上あるかだけを返す。本文は読み出さない。 */
export async function hasActiveSourceRecords(
  db: AccountDataDatabase,
  accountId: string,
): Promise<boolean> {
  const record = await db
    .select({ id: sourceRecords.id })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.accountId, accountId), eq(sourceRecords.isDeleted, false)))
    .limit(1)
    .get();
  return record !== undefined;
}
