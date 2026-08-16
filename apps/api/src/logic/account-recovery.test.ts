import path from "node:path";
import { D1 } from "@me-builder/lib";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { recoverAccountWithCode } from "./account-recovery";

function createTestDb(): D1.shared.Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: D1.shared.schema });
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle migratorをD1 clientと共用するtest adapter。
  migrate(db as any, {
    migrationsFolder: path.resolve(__dirname, "../../../../packages/lib/drizzle"),
  });
  Object.defineProperty(db, "batch", {
    value: async (queries: Array<{ run: () => unknown }>) =>
      sqlite.transaction(() => queries.map((query) => query.run()))(),
  });
  return db as unknown as D1.shared.Client;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function fixture() {
  const db = createTestDb();
  const target = await D1.shared.action.account.upsertIdentity(db, {
    provider: "line_login",
    providerAccountId: "old-line-identity",
  });
  const credentialId = crypto.randomUUID();
  const secret = "recovery-secret";
  const salt = "test-salt";
  const secretHash = `v1.${salt}.${await sha256Base64Url(`${salt}:${secret}`)}`;
  await D1.shared.action.accountRecovery.issueAccountRecoveryCredential(db, {
    id: credentialId,
    accountId: target.account.id,
    secretHash,
    expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    now: new Date("2026-08-01T00:00:00.000Z"),
  });
  return {
    db,
    accountId: target.account.id,
    code: `${credentialId}.${secret}`,
    now: new Date("2026-08-16T00:00:00.000Z"),
  };
}

describe("account recovery authentication boundary", () => {
  it("復旧対象をコードから決定し、初回成功時だけ復旧先と移管元のsessionを失効する", async () => {
    const { db, accountId, code, now } = await fixture();
    const source = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "new-line-identity",
    });
    const invalidateAccountSessions = vi.fn();
    const params = {
      db,
      identity: { subject: "new-line-identity" },
      sourceAccountId: source.account.id,
      code,
      requestKey: "request-key",
      now,
    };

    await expect(
      recoverAccountWithCode(params, { invalidateAccountSessions }),
    ).resolves.toMatchObject({ type: "recovered", accountId, alreadyRecovered: false });
    await expect(
      recoverAccountWithCode(
        { ...params, sourceAccountId: accountId },
        { invalidateAccountSessions },
      ),
    ).resolves.toMatchObject({ type: "recovered", accountId, alreadyRecovered: true });
    expect(invalidateAccountSessions).toHaveBeenNthCalledWith(1, accountId);
    expect(invalidateAccountSessions).toHaveBeenNthCalledWith(2, source.account.id);
    expect(invalidateAccountSessions).toHaveBeenCalledTimes(2);
  });

  it("別Accountに接続済みのIdentityを拒否し、sessionを失効しない", async () => {
    const { db, code, now } = await fixture();
    const source = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "other-account-identity",
    });
    await D1.shared.action.account.upsertIdentity(db, {
      provider: "line",
      providerAccountId: "other-account-identity",
    });
    const invalidateAccountSessions = vi.fn();

    await expect(
      recoverAccountWithCode(
        {
          db,
          identity: { subject: "other-account-identity" },
          sourceAccountId: source.account.id,
          code,
          requestKey: "request-key",
          now,
        },
        { invalidateAccountSessions },
      ),
    ).resolves.toEqual({ type: "identity-conflict" });
    expect(invalidateAccountSessions).not.toHaveBeenCalled();
  });

  it("使用済みコードを異なるIdentityでは再利用できない", async () => {
    const { db, code, now } = await fixture();
    const firstSource = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "first-new-identity",
    });
    await recoverAccountWithCode({
      db,
      identity: { subject: "first-new-identity" },
      sourceAccountId: firstSource.account.id,
      code,
      requestKey: "first-request",
      now,
    });
    const invalidateAccountSessions = vi.fn();
    const secondSource = await D1.shared.action.account.upsertIdentity(db, {
      provider: "line_login",
      providerAccountId: "second-new-identity",
    });

    await expect(
      recoverAccountWithCode(
        {
          db,
          identity: { subject: "second-new-identity" },
          sourceAccountId: secondSource.account.id,
          code,
          requestKey: "second-request",
          now,
        },
        { invalidateAccountSessions },
      ),
    ).resolves.toEqual({ type: "invalid-code" });
    expect(invalidateAccountSessions).not.toHaveBeenCalled();
  });
});
