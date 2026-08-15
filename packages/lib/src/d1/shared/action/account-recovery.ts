import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { accountIdentities } from "../schema/account";
import { accountRecoveryAudits, accountRecoveryCredentials } from "../schema/account-recovery";

export async function issueAccountRecoveryCredential(
  db: SharedD1Client,
  input: { id: string; accountId: string; secretHash: string; expiresAt: Date; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db.batch([
    db
      .update(accountRecoveryCredentials)
      .set({ revokedAt: now })
      .where(
        and(
          eq(accountRecoveryCredentials.accountId, input.accountId),
          isNull(accountRecoveryCredentials.usedAt),
          isNull(accountRecoveryCredentials.revokedAt),
        ),
      ),
    db.insert(accountRecoveryCredentials).values({
      id: input.id,
      accountId: input.accountId,
      secretHash: input.secretHash,
      expiresAt: input.expiresAt,
      createdAt: now,
    }),
    db.insert(accountRecoveryAudits).values({
      operationId: crypto.randomUUID(),
      accountId: input.accountId,
      action: "issue",
      outcome: "succeeded",
      createdAt: now,
    }),
  ]);
}

export async function findAccountRecoveryCredential(db: SharedD1Client, id: string) {
  return await db.query.accountRecoveryCredentials.findFirst({
    where: (table, { eq }) => eq(table.id, id),
  });
}

export type CompleteAccountRecoveryResult =
  | "recovered"
  | "already-recovered"
  | "conflict"
  | "invalid";

export async function completeAccountRecovery(
  db: SharedD1Client,
  input: {
    credentialId: string;
    expectedSecretHash: string;
    newProviderAccountId: string;
    identityFingerprint: string;
    now?: Date;
  },
): Promise<CompleteAccountRecoveryResult> {
  const now = input.now ?? new Date();
  let credential = await findAccountRecoveryCredential(db, input.credentialId);
  if (
    !credential ||
    credential.secretHash !== input.expectedSecretHash ||
    credential.revokedAt ||
    credential.expiresAt.getTime() <= now.getTime()
  ) {
    return "invalid";
  }
  const existingIdentity = await db.query.accountIdentities.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.provider, "line_login"),
        eq(table.providerAccountId, input.newProviderAccountId),
        eq(table.isDeleted, false),
      ),
  });
  if (credential.usedAt) {
    return existingIdentity?.accountId === credential.accountId ? "already-recovered" : "invalid";
  }
  if (existingIdentity && existingIdentity.accountId !== credential.accountId) return "conflict";

  await db
    .update(accountRecoveryCredentials)
    .set({ claimedIdentityHash: input.identityFingerprint, claimedAt: now })
    .where(
      and(
        eq(accountRecoveryCredentials.id, input.credentialId),
        isNull(accountRecoveryCredentials.claimedIdentityHash),
        isNull(accountRecoveryCredentials.usedAt),
      ),
    );
  credential = await findAccountRecoveryCredential(db, input.credentialId);
  if (!credential || credential.claimedIdentityHash !== input.identityFingerprint)
    return "conflict";

  const queries = [];
  if (!existingIdentity) {
    queries.push(
      db.insert(accountIdentities).values({
        id: crypto.randomUUID(),
        accountId: credential.accountId,
        provider: "line_login",
        providerAccountId: input.newProviderAccountId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        isDeleted: false,
      }),
    );
  }
  queries.push(
    db
      .update(accountIdentities)
      .set({ isDeleted: true, deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(accountIdentities.accountId, credential.accountId),
          inArray(accountIdentities.provider, ["line", "line_login"]),
          ne(accountIdentities.providerAccountId, input.newProviderAccountId),
          eq(accountIdentities.isDeleted, false),
        ),
      ),
    db
      .update(accountRecoveryCredentials)
      .set({ usedAt: now })
      .where(
        and(
          eq(accountRecoveryCredentials.id, input.credentialId),
          eq(accountRecoveryCredentials.claimedIdentityHash, input.identityFingerprint),
          isNull(accountRecoveryCredentials.usedAt),
        ),
      ),
    db.insert(accountRecoveryAudits).values({
      operationId: crypto.randomUUID(),
      accountId: credential.accountId,
      action: "complete",
      outcome: "succeeded",
      identityFingerprint: input.identityFingerprint,
      createdAt: now,
    }),
  );
  // Drizzleのbatch tuple型は可変長配列を受けないため、実行境界で共通query型へ狭める。
  await db.batch(queries as [(typeof queries)[number], ...Array<(typeof queries)[number]>]);
  return "recovered";
}
