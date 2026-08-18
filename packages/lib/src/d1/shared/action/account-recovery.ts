import { and, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { SharedD1Client } from "../client";
import { accountIdentities, accounts } from "../schema/account";
import {
  accountRecoveryAudits,
  accountRecoveryCredentials,
  accountRecoveryRateLimits,
} from "../schema/account-recovery";

export const ACCOUNT_RECOVERY_MAX_FAILED_ATTEMPTS = 5;
const ACCOUNT_RECOVERY_ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const ACCOUNT_RECOVERY_LOCK_MS = 30 * 60 * 1_000;

function changed(result: unknown): number {
  return (
    (result as { meta?: { changes?: number }; changes?: number } | undefined)?.meta?.changes ??
    (result as { changes?: number } | undefined)?.changes ??
    0
  );
}

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
    sourceAccountId: string;
    sourceIdentityId: string;
    identityFingerprint: string;
    now?: Date;
  },
): Promise<CompleteAccountRecoveryResult> {
  const now = input.now ?? new Date();
  const credential = await findAccountRecoveryCredential(db, input.credentialId);
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
  const account = await db.query.accounts.findFirst({
    columns: { status: true, isDeleted: true },
    where: (table, { eq }) => eq(table.id, accountId),
  });
  // コード発行後にAccountが削除・停止された場合も、Identityを再接続しない。
  if (!account || account.status !== "active" || account.isDeleted) return "invalid";
  if (credential.usedAt) {
    return existingIdentities.some((identity) => identity.accountId === accountId)
      ? "already-recovered"
      : "invalid";
  }
  if (
    existingIdentities.some(
      (identity) =>
        identity.accountId !== accountId && identity.accountId !== input.sourceAccountId,
    )
  ) {
    return "conflict";
  }
  const sourceIdentity = existingIdentities.find(
    (identity) =>
      identity.id === input.sourceIdentityId &&
      identity.accountId === input.sourceAccountId &&
      identity.provider === "line_login",
  );
  if (!sourceIdentity) return "invalid";

  // request固有tokenでコード消費を先取りし、同じbatch内で勝者だけが後続更新を行う。
  // claimとconsumeを分けると、同じIdentityからの並行要求が双方とも移管へ進み得る。
  const claimToken = crypto.randomUUID();
  const auditOperationId = crypto.randomUUID();
  const claimMatches = sql`exists (
    select 1 from ${accountRecoveryCredentials}
    where ${accountRecoveryCredentials.id} = ${input.credentialId}
      and ${accountRecoveryCredentials.claimedIdentityHash} = ${claimToken}
      and ${accountRecoveryCredentials.usedAt} is not null
  )`;
  const targetAccountIsActive = sql`exists (
    select 1 from ${accounts}
    where ${accounts.id} = ${accountId}
      and ${accounts.status} = 'active'
      and ${accounts.isDeleted} = false
  )`;
  const sourceIdentityIsEligible = sql`exists (
    select 1 from ${accountIdentities}
    where ${accountIdentities.id} = ${input.sourceIdentityId}
      and ${accountIdentities.accountId} = ${input.sourceAccountId}
      and ${accountIdentities.provider} = 'line_login'
      and ${accountIdentities.providerAccountId} = ${input.newProviderAccountId}
      and ${accountIdentities.isDeleted} = false
  )`;
  const hasNoThirdAccountConflict = sql`not exists (
    select 1 from ${accountIdentities}
    where ${accountIdentities.provider} in ('line', 'line_login')
      and ${accountIdentities.providerAccountId} = ${input.newProviderAccountId}
      and ${accountIdentities.accountId} <> ${accountId}
      and ${accountIdentities.accountId} <> ${input.sourceAccountId}
      and ${accountIdentities.isDeleted} = false
  )`;
  const consume = db
    .update(accountRecoveryCredentials)
    .set({ claimedIdentityHash: claimToken, claimedAt: now, usedAt: now })
    .where(
      and(
        eq(accountRecoveryCredentials.id, input.credentialId),
        eq(accountRecoveryCredentials.secretHash, input.expectedSecretHash),
        gt(accountRecoveryCredentials.expiresAt, now),
        isNull(accountRecoveryCredentials.claimedIdentityHash),
        isNull(accountRecoveryCredentials.usedAt),
        isNull(accountRecoveryCredentials.revokedAt),
        targetAccountIsActive,
        sourceIdentityIsEligible,
        hasNoThirdAccountConflict,
      ),
    );

  const queries = [];
  queries.push(consume);
  if (sourceIdentity.accountId !== accountId) {
    queries.push(
      db
        .update(accountIdentities)
        .set({ accountId, updatedAt: now })
        .where(
          and(
            eq(accountIdentities.id, sourceIdentity.id),
            eq(accountIdentities.accountId, input.sourceAccountId),
            eq(accountIdentities.provider, "line_login"),
            eq(accountIdentities.isDeleted, false),
            claimMatches,
          ),
        ),
    );
  }
  queries.push(
    // Identity再接続と同じD1 batchで復旧先のversionを進め、旧sessionを即時失効させる。
    db
      .update(accounts)
      .set({ sessionVersion: sql`${accounts.sessionVersion} + 1`, updatedAt: now })
      .where(and(eq(accounts.id, credential.accountId), claimMatches)),
    db
      .update(accountIdentities)
      .set({ isDeleted: true, deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(accountIdentities.accountId, credential.accountId),
          inArray(accountIdentities.provider, ["line", "line_login"]),
          ne(accountIdentities.providerAccountId, input.newProviderAccountId),
          eq(accountIdentities.isDeleted, false),
          claimMatches,
        ),
      ),
  );
  if (input.sourceAccountId !== credential.accountId) {
    // Identity移管後も移管元Accountのsessionが残らないよう、同じbatchで失効させる。
    queries.push(
      db
        .update(accounts)
        .set({ sessionVersion: sql`${accounts.sessionVersion} + 1`, updatedAt: now })
        .where(and(eq(accounts.id, input.sourceAccountId), claimMatches)),
    );
  }
  queries.push(
    db.insert(accountRecoveryAudits).select(
      db
        .select({
          operationId: sql<string>`${auditOperationId}`.as("operation_id"),
          accountId: accountRecoveryCredentials.accountId,
          action: sql<"complete">`'complete'`.as("action"),
          outcome: sql<"succeeded">`'succeeded'`.as("outcome"),
          reason: sql<string | null>`null`.as("reason"),
          identityFingerprint: sql<string>`${input.identityFingerprint}`.as("identity_fingerprint"),
          createdAt: sql<Date>`${accountRecoveryCredentials.claimedAt}`.as("created_at"),
        })
        .from(accountRecoveryCredentials)
        .where(
          and(
            eq(accountRecoveryCredentials.id, input.credentialId),
            eq(accountRecoveryCredentials.claimedIdentityHash, claimToken),
          ),
        ),
    ),
  );
  // Drizzleのbatch tuple型は可変長配列を受けないため、実行境界で共通query型へ狭める。
  const [consumeResult] = await db.batch(
    queries as [(typeof queries)[number], ...Array<(typeof queries)[number]>],
  );
  if (changed(consumeResult) !== 1) {
    const current = await findAccountRecoveryCredential(db, input.credentialId);
    if (!current?.usedAt) return "invalid";
    const recoveredIdentity = await db.query.accountIdentities.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, input.sourceIdentityId),
          eq(table.accountId, accountId),
          eq(table.provider, "line_login"),
          eq(table.providerAccountId, input.newProviderAccountId),
          eq(table.isDeleted, false),
        ),
    });
    return recoveredIdentity ? "already-recovered" : "invalid";
  }
  return "recovered";
}
