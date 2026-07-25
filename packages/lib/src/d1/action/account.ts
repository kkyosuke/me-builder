import { and, eq } from "drizzle-orm";
import type { D1Client } from "../client";
import { accountIdentities, accounts } from "../schema/account";

export type UpsertIdentityInput = {
  provider: "line" | "google";
  providerAccountId: string;
};

export type UpsertIdentityResult = {
  account: typeof accounts.$inferSelect;
  identity: typeof accountIdentities.$inferSelect;
};

/**
 * Upserts accounts and account_identities records in D1 based on provider identity.
 * Uses a single JOIN query to fetch existing identity & account, and D1 batching for new insertions.
 */
export async function upsertIdentity(
  db: D1Client,
  input: UpsertIdentityInput,
): Promise<UpsertIdentityResult> {
  const now = new Date();

  // Find existing identity and linked active account in a single JOIN query
  const found = await db
    .select({
      account: accounts,
      identity: accountIdentities,
    })
    .from(accountIdentities)
    .innerJoin(accounts, eq(accountIdentities.accountId, accounts.id))
    .where(
      and(
        eq(accountIdentities.provider, input.provider),
        eq(accountIdentities.providerAccountId, input.providerAccountId),
        eq(accountIdentities.isDeleted, false),
        eq(accounts.isDeleted, false),
      ),
    )
    .get();

  if (found) {
    return {
      account: found.account,
      identity: found.identity,
    };
  }

  // Create new account & identity link atomically using D1 batch
  const accountId = crypto.randomUUID();
  const account: typeof accounts.$inferSelect = {
    id: accountId,
    status: "active",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    isDeleted: false,
  };

  const identityId = crypto.randomUUID();
  const identity: typeof accountIdentities.$inferSelect = {
    id: identityId,
    accountId,
    provider: input.provider,
    providerAccountId: input.providerAccountId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    isDeleted: false,
  };

  await db.batch([
    db.insert(accounts).values(account),
    db.insert(accountIdentities).values(identity),
  ]);

  return { account, identity };
}
