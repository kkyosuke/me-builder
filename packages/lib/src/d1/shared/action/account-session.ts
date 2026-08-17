import { eq, sql } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { accounts } from "../schema";

export async function findActiveAccountSessionVersion(
  db: SharedD1Client,
  accountId: string,
): Promise<number | undefined> {
  const account = await db.query.accounts.findFirst({
    columns: { sessionVersion: true, status: true, isDeleted: true },
    where: (table, { eq }) => eq(table.id, accountId),
  });
  return account?.status === "active" && !account.isDeleted ? account.sessionVersion : undefined;
}

export async function invalidateAccountSessions(
  db: SharedD1Client,
  accountId: string,
): Promise<number | undefined> {
  const [account] = await db
    .update(accounts)
    .set({ sessionVersion: sql`${accounts.sessionVersion} + 1`, updatedAt: new Date() })
    .where(eq(accounts.id, accountId))
    .returning({ sessionVersion: accounts.sessionVersion });
  return account?.sessionVersion;
}
