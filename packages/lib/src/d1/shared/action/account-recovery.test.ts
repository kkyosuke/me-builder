import path from "node:path";
import Database from "better-sqlite3";
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

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle migratorをD1 clientと共用するtest adapter。
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
  Object.defineProperty(db, "batch", {
    value: async (queries: Array<{ run: () => unknown }>) =>
      sqlite.transaction(() => queries.map((query) => query.run()))(),
  });
  return db as unknown as SharedD1Client;
}

describe("account recovery action", () => {
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
