import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import { upsertIdentity } from "./account";
import {
  ACCOUNT_RECOVERY_MAX_FAILED_ATTEMPTS,
  completeAccountRecovery,
  isAccountRecoveryRateLimited,
  issueAccountRecoveryCredential,
  recordAccountRecoveryFailure,
} from "./account-recovery";

type BatchControl = { beforeNextBatch: (() => void | Promise<void>) | undefined };

function createTestDb(control?: BatchControl): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle migratorをD1 clientと共用するtest adapter。
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
  Object.defineProperty(db, "batch", {
    value: async (queries: Array<{ run: () => unknown }>) => {
      const beforeBatch = control?.beforeNextBatch;
      if (control) control.beforeNextBatch = undefined;
      await beforeBatch?.();
      return sqlite.transaction(() => queries.map((query) => query.run()))();
    },
  });
  return db as unknown as SharedD1Client;
}

describe("account recovery action", () => {
  it("認証済みsource AccountのLINE Identityを復旧対象Accountへ移す", async () => {
    const db = createTestDb();
    const target = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-old-transfer",
    });
    const source = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-new-transfer",
    });
    await db.insert(schema.accountIdentities).values({
      id: "legacy-line-identity",
      accountId: source.account.id,
      provider: "line",
      providerAccountId: "line-new-transfer",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      updatedAt: new Date("2026-08-01T00:00:00Z"),
      isDeleted: false,
    });
    await issueAccountRecoveryCredential(db, {
      id: "credential-transfer",
      accountId: target.account.id,
      secretHash: "secret-hash",
      expiresAt: new Date("2026-09-01T00:00:00Z"),
      now: new Date("2026-08-01T00:00:00Z"),
    });

    await expect(
      completeAccountRecovery(db, {
        credentialId: "credential-transfer",
        expectedSecretHash: "secret-hash",
        newProviderAccountId: "line-new-transfer",
        sourceAccountId: source.account.id,
        sourceIdentityId: source.identity.id,
        identityFingerprint: "identity-fingerprint",
        now: new Date("2026-08-15T00:00:00Z"),
      }),
    ).resolves.toBe("recovered");

    await expect(
      db.query.accountIdentities.findMany({
        where: (table, { eq }) => eq(table.providerAccountId, "line-new-transfer"),
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: source.identity.id,
          accountId: target.account.id,
          provider: "line_login",
          isDeleted: false,
        }),
        expect.objectContaining({
          id: "legacy-line-identity",
          accountId: source.account.id,
          provider: "line",
          isDeleted: false,
        }),
      ]),
    );
    await expect(
      db.query.accounts.findMany({
        columns: { id: true, sessionVersion: true },
        where: (table, { inArray }) => inArray(table.id, [target.account.id, source.account.id]),
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        { id: target.account.id, sessionVersion: 2 },
        { id: source.account.id, sessionVersion: 2 },
      ]),
    );
  });

  it("コード発行後に削除されたAccountへIdentityを再接続しない", async () => {
    const db = createTestDb();
    const target = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-old",
    });
    await issueAccountRecoveryCredential(db, {
      id: "credential-deleted",
      accountId: target.account.id,
      secretHash: "secret-hash",
      expiresAt: new Date("2026-09-01T00:00:00Z"),
      now: new Date("2026-08-01T00:00:00Z"),
    });
    await db
      .update(schema.accounts)
      .set({ isDeleted: true, deletedAt: new Date("2026-08-10T00:00:00Z") })
      .where(eq(schema.accounts.id, target.account.id));

    await expect(
      completeAccountRecovery(db, {
        credentialId: "credential-deleted",
        expectedSecretHash: "secret-hash",
        newProviderAccountId: "line-new",
        sourceAccountId: target.account.id,
        sourceIdentityId: target.identity.id,
        identityFingerprint: "identity-fingerprint",
        now: new Date("2026-08-15T00:00:00Z"),
      }),
    ).resolves.toBe("invalid");
    await expect(
      db.query.accountIdentities.findFirst({
        where: (table, { eq }) => eq(table.providerAccountId, "line-new"),
      }),
    ).resolves.toBeUndefined();
  });

  it("コード発行後に停止されたAccountへIdentityを再接続しない", async () => {
    const db = createTestDb();
    const target = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-old-stopped",
    });
    await issueAccountRecoveryCredential(db, {
      id: "credential-stopped",
      accountId: target.account.id,
      secretHash: "secret-hash",
      expiresAt: new Date("2026-09-01T00:00:00Z"),
      now: new Date("2026-08-01T00:00:00Z"),
    });
    await db
      .update(schema.accounts)
      .set({ status: "stopped" })
      .where(eq(schema.accounts.id, target.account.id));

    await expect(
      completeAccountRecovery(db, {
        credentialId: "credential-stopped",
        expectedSecretHash: "secret-hash",
        newProviderAccountId: "line-new-stopped",
        sourceAccountId: target.account.id,
        sourceIdentityId: target.identity.id,
        identityFingerprint: "identity-fingerprint",
        now: new Date("2026-08-15T00:00:00Z"),
      }),
    ).resolves.toBe("invalid");
  });

  it("Identity再接続と同じbatchでsession versionを1度だけ進める", async () => {
    const db = createTestDb();
    const target = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-old-version",
    });
    await issueAccountRecoveryCredential(db, {
      id: "credential-version",
      accountId: target.account.id,
      secretHash: "secret-hash",
      expiresAt: new Date("2026-09-01T00:00:00Z"),
      now: new Date("2026-08-01T00:00:00Z"),
    });
    const input = {
      credentialId: "credential-version",
      expectedSecretHash: "secret-hash",
      newProviderAccountId: "line-old-version",
      sourceAccountId: target.account.id,
      sourceIdentityId: target.identity.id,
      identityFingerprint: "identity-fingerprint",
      now: new Date("2026-08-15T00:00:00Z"),
    };

    await expect(completeAccountRecovery(db, input)).resolves.toBe("recovered");
    await expect(
      db.query.accounts.findFirst({
        columns: { sessionVersion: true },
        where: (table, { eq }) => eq(table.id, target.account.id),
      }),
    ).resolves.toEqual({ sessionVersion: 2 });

    await expect(completeAccountRecovery(db, input)).resolves.toBe("already-recovered");
    await expect(
      db.query.accounts.findFirst({
        columns: { sessionVersion: true },
        where: (table, { eq }) => eq(table.id, target.account.id),
      }),
    ).resolves.toEqual({ sessionVersion: 2 });
  });

  it("2つのIdentityが同じコードを同時消費しても1つだけを原子的に復旧する", async () => {
    const db = createTestDb();
    const target = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-old-race",
    });
    const browserA = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-new-race-a",
    });
    const browserB = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-new-race-b",
    });
    await issueAccountRecoveryCredential(db, {
      id: "credential-race",
      accountId: target.account.id,
      secretHash: "secret-hash",
      expiresAt: new Date("2026-09-01T00:00:00Z"),
      now: new Date("2026-08-01T00:00:00Z"),
    });
    const now = new Date("2026-08-15T00:00:00Z");

    const results = await Promise.all([
      completeAccountRecovery(db, {
        credentialId: "credential-race",
        expectedSecretHash: "secret-hash",
        newProviderAccountId: "line-new-race-a",
        sourceAccountId: browserA.account.id,
        sourceIdentityId: browserA.identity.id,
        identityFingerprint: "identity-fingerprint-a",
        now,
      }),
      completeAccountRecovery(db, {
        credentialId: "credential-race",
        expectedSecretHash: "secret-hash",
        newProviderAccountId: "line-new-race-b",
        sourceAccountId: browserB.account.id,
        sourceIdentityId: browserB.identity.id,
        identityFingerprint: "identity-fingerprint-b",
        now,
      }),
    ]);

    expect([...results].sort()).toEqual(["invalid", "recovered"]);
    const activeNewIdentities = await db.query.accountIdentities.findMany({
      where: (table, { and, eq, inArray }) =>
        and(
          inArray(table.providerAccountId, ["line-new-race-a", "line-new-race-b"]),
          eq(table.accountId, target.account.id),
          eq(table.isDeleted, false),
        ),
    });
    expect(activeNewIdentities).toHaveLength(1);
    const accountsAfterRecovery = await db.query.accounts.findMany({
      columns: { id: true, sessionVersion: true },
      where: (table, { inArray }) =>
        inArray(table.id, [target.account.id, browserA.account.id, browserB.account.id]),
    });
    expect(accountsAfterRecovery.filter((account) => account.sessionVersion === 2)).toHaveLength(2);
    expect(await db.query.accountRecoveryAudits.findMany()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "complete", outcome: "succeeded" }),
      ]),
    );
    expect(
      (await db.query.accountRecoveryAudits.findMany()).filter(
        (audit) => audit.action === "complete" && audit.outcome === "succeeded",
      ),
    ).toHaveLength(1);
  });

  it("事前確認後に移管元Identityが失効してもコード消費と成功監査を残さない", async () => {
    const control: BatchControl = { beforeNextBatch: undefined };
    const db = createTestDb(control);
    const target = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-old-stale-source",
    });
    const source = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-new-stale-source",
    });
    await issueAccountRecoveryCredential(db, {
      id: "credential-stale-source",
      accountId: target.account.id,
      secretHash: "secret-hash",
      expiresAt: new Date("2026-09-01T00:00:00Z"),
      now: new Date("2026-08-01T00:00:00Z"),
    });
    control.beforeNextBatch = async () => {
      await db
        .update(schema.accountIdentities)
        .set({
          isDeleted: true,
          deletedAt: new Date("2026-08-15T00:00:00Z"),
          updatedAt: new Date("2026-08-15T00:00:00Z"),
        })
        .where(eq(schema.accountIdentities.id, source.identity.id));
    };

    await expect(
      completeAccountRecovery(db, {
        credentialId: "credential-stale-source",
        expectedSecretHash: "secret-hash",
        newProviderAccountId: "line-new-stale-source",
        sourceAccountId: source.account.id,
        sourceIdentityId: source.identity.id,
        identityFingerprint: "identity-fingerprint",
        now: new Date("2026-08-15T00:00:00Z"),
      }),
    ).resolves.toBe("invalid");
    await expect(
      db.query.accountRecoveryCredentials.findFirst({
        where: (table, { eq }) => eq(table.id, "credential-stale-source"),
      }),
    ).resolves.toMatchObject({ claimedAt: null, usedAt: null });
    await expect(
      db.query.accounts.findFirst({
        columns: { sessionVersion: true },
        where: (table, { eq }) => eq(table.id, target.account.id),
      }),
    ).resolves.toEqual({ sessionVersion: 1 });
    expect(
      (await db.query.accountRecoveryAudits.findMany()).filter(
        (audit) => audit.action === "complete" && audit.outcome === "succeeded",
      ),
    ).toHaveLength(0);
  });

  it("Messaging API側で別Accountに接続済みのLINE Identityを拒否する", async () => {
    const db = createTestDb();
    const target = await upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "line-old",
    });
    const other = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "line-new",
    });
    expect(other.account.id).not.toBe(target.account.id);
    await issueAccountRecoveryCredential(db, {
      id: "credential-1",
      accountId: target.account.id,
      secretHash: "secret-hash",
      expiresAt: new Date("2026-09-01T00:00:00Z"),
      now: new Date("2026-08-01T00:00:00Z"),
    });

    await expect(
      completeAccountRecovery(db, {
        credentialId: "credential-1",
        expectedSecretHash: "secret-hash",
        newProviderAccountId: "line-new",
        sourceAccountId: target.account.id,
        sourceIdentityId: target.identity.id,
        identityFingerprint: "identity-fingerprint",
        now: new Date("2026-08-15T00:00:00Z"),
      }),
    ).resolves.toBe("conflict");
  });

  it("Identityとrequest scopeを5回失敗でロックし、期限後に新しいwindowを開始する", async () => {
    const db = createTestDb();
    const keys = ["identity-key", "request-key"];
    const startedAt = new Date("2026-08-15T00:00:00Z");
    for (let attempt = 0; attempt < ACCOUNT_RECOVERY_MAX_FAILED_ATTEMPTS - 1; attempt += 1) {
      await recordAccountRecoveryFailure(db, keys, startedAt);
    }
    await expect(isAccountRecoveryRateLimited(db, keys, startedAt)).resolves.toBe(false);

    await recordAccountRecoveryFailure(db, keys, startedAt);
    await expect(isAccountRecoveryRateLimited(db, keys, startedAt)).resolves.toBe(true);
    const afterLock = new Date("2026-08-15T00:31:00Z");
    await expect(isAccountRecoveryRateLimited(db, keys, afterLock)).resolves.toBe(false);

    await recordAccountRecoveryFailure(db, keys, afterLock);
    const rows = await db.query.accountRecoveryRateLimits.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.failedAttempts === 1 && row.lockedUntil === null)).toBe(true);
  });
});
