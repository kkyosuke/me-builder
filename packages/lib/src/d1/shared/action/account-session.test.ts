import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import { stopAccount, unlinkIdentity } from "./account";
import { findActiveAccountSessionVersion, invalidateAccountSessions } from "./account-session";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
  Object.defineProperty(db, "batch", {
    value: async (queries: Array<{ run: () => unknown }>) =>
      sqlite.transaction(() => queries.map((query) => query.run()))(),
  });
  return db as unknown as SharedD1Client;
}

describe("account session version", () => {
  it("失効ごとにversionを単調増加させる", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-1" });

    await expect(findActiveAccountSessionVersion(db, "account-1")).resolves.toBe(1);
    await expect(invalidateAccountSessions(db, "account-1")).resolves.toBe(2);
    await expect(invalidateAccountSessions(db, "account-1")).resolves.toBe(3);
    await expect(findActiveAccountSessionVersion(db, "account-1")).resolves.toBe(3);
  });

  it("削除済みAccountのversionを認証に使わない", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "deleted", isDeleted: true });

    await expect(findActiveAccountSessionVersion(db, "deleted")).resolves.toBeUndefined();
  });

  it("Account停止と同時にversionを更新して認証対象外にする", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "stopped" });

    await expect(stopAccount(db, "stopped")).resolves.toBe(true);
    await expect(findActiveAccountSessionVersion(db, "stopped")).resolves.toBeUndefined();
    await expect(db.query.accounts.findFirst()).resolves.toMatchObject({
      status: "stopped",
      sessionVersion: 2,
    });
  });

  it("identity解除と同じbatchでsession versionを更新する", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values({ id: "account-1" });
    await db.insert(schema.accountIdentities).values({
      id: "identity-1",
      accountId: "account-1",
      provider: "line_login",
      providerAccountId: "provider-account-1",
    });

    await expect(
      unlinkIdentity(db, { accountId: "account-1", identityId: "identity-1" }),
    ).resolves.toBe(true);
    await expect(findActiveAccountSessionVersion(db, "account-1")).resolves.toBe(2);
    await expect(db.query.accountIdentities.findFirst()).resolves.toMatchObject({
      isDeleted: true,
    });
  });
});
