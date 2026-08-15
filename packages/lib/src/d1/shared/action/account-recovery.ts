import { and, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { accountIdentities } from "../schema/account";
import {
  accountRecoveryAudits,
  accountRecoveryCredentials,
  accountRecoveryRateLimits,
} from "../schema/account-recovery";

export const ACCOUNT_RECOVERY_MAX_FAILED_ATTEMPTS = 5;
const ACCOUNT_RECOVERY_ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const ACCOUNT_RECOVERY_LOCK_MS = 30 * 60 * 1_000;

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

export async function recordAccountRecoveryAudit(
  db: SharedD1Client,
  input: {
    accountId: string | null;
    action: "issue" | "complete";
    outcome: "succeeded" | "rejected";
    reason?: string;
    identityFingerprint?: string;
    now?: Date;
  },
): Promise<void> {
  await db.insert(accountRecoveryAudits).values({
    operationId: crypto.randomUUID(),
    accountId: input.accountId,
    action: input.action,
    outcome: input.outcome,
    reason: input.reason ?? null,
    identityFingerprint: input.identityFingerprint ?? null,
    createdAt: input.now ?? new Date(),
  });
}

export async function isAccountRecoveryRateLimited(
  db: SharedD1Client,
  keyHashes: readonly string[],
  now = new Date(),
): Promise<boolean> {
  if (keyHashes.length === 0) return false;
  const rows = await db.query.accountRecoveryRateLimits.findMany({
    where: (table, { inArray }) => inArray(table.keyHash, [...keyHashes]),
  });
  return rows.some((row) => row.lockedUntil !== null && row.lockedUntil.getTime() > now.getTime());
}

export async function recordAccountRecoveryFailure(
  db: SharedD1Client,
  keyHashes: readonly string[],
  now = new Date(),
): Promise<void> {
  if (keyHashes.length === 0) return;
  const uniqueKeys = [...new Set(keyHashes)];
  const windowThreshold = new Date(now.getTime() - ACCOUNT_RECOVERY_ATTEMPT_WINDOW_MS);
  const lockedUntilSeconds = Math.floor((now.getTime() + ACCOUNT_RECOVERY_LOCK_MS) / 1_000);
  const queries = uniqueKeys.flatMap((keyHash) => [
    db
      .delete(accountRecoveryRateLimits)
      .where(
        and(
          eq(accountRecoveryRateLimits.keyHash, keyHash),
          lte(accountRecoveryRateLimits.updatedAt, windowThreshold),
        ),
      ),
    db
      .insert(accountRecoveryRateLimits)
      .values({
        keyHash,
        failedAttempts: 1,
        windowStartedAt: now,
        lockedUntil: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: accountRecoveryRateLimits.keyHash,
        set: {
          failedAttempts: sql`${accountRecoveryRateLimits.failedAttempts} + 1`,
          lockedUntil: sql`case when ${accountRecoveryRateLimits.failedAttempts} >= ${ACCOUNT_RECOVERY_MAX_FAILED_ATTEMPTS - 1} then ${lockedUntilSeconds} else ${accountRecoveryRateLimits.lockedUntil} end`,
          updatedAt: now,
        },
      }),
  ]);
  await db.batch(queries as [(typeof queries)[number], ...Array<(typeof queries)[number]>]);
}

export async function clearAccountRecoveryFailures(
  db: SharedD1Client,
  keyHashes: readonly string[],
): Promise<void> {
  if (keyHashes.length === 0) return;
  await db
    .delete(accountRecoveryRateLimits)
    .where(inArray(accountRecoveryRateLimits.keyHash, [...new Set(keyHashes)]));
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
  const existingIdentities = await db.query.accountIdentities.findMany({
    where: (table, { and, eq, inArray }) =>
      and(
        inArray(table.provider, ["line", "line_login"]),
        eq(table.providerAccountId, input.newProviderAccountId),
        eq(table.isDeleted, false),
      ),
  });
  const accountId = credential.accountId;
  if (credential.usedAt) {
    return existingIdentities.some((identity) => identity.accountId === accountId)
      ? "already-recovered"
      : "invalid";
  }
  if (existingIdentities.some((identity) => identity.accountId !== accountId)) {
    return "conflict";
  }

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
  if (!existingIdentities.some((identity) => identity.provider === "line_login")) {
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
