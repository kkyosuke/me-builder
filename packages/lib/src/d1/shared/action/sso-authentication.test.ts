import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import { claimSsoAuthenticationTransaction } from "./sso-authentication";

function createTestDb(): SharedD1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: better-sqlite3でD1 migrationを検証するfixture
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
  return db as unknown as SharedD1Client;
}

describe("SSO authentication transaction", () => {
  it("同じstateの同時consume claimを1件だけ許可する", async () => {
    const db = createTestDb();
    const claimed = await Promise.all([
      claimSsoAuthenticationTransaction(db, {
        stateHash: "hashed-state",
        expiresAt: 601_000,
        removeExpiredBefore: 1_000,
      }),
      claimSsoAuthenticationTransaction(db, {
        stateHash: "hashed-state",
        expiresAt: 601_000,
        removeExpiredBefore: 1_000,
      }),
    ]);

    expect(claimed.sort()).toEqual([false, true]);
  });

  it("新しいclaim時に期限切れclaimだけを除去する", async () => {
    const db = createTestDb();
    await claimSsoAuthenticationTransaction(db, {
      stateHash: "expired",
      expiresAt: 1_000,
      removeExpiredBefore: 0,
    });
    await expect(
      claimSsoAuthenticationTransaction(db, {
        stateHash: "active",
        expiresAt: 3_000,
        removeExpiredBefore: 1_000,
      }),
    ).resolves.toBe(true);
    await expect(
      claimSsoAuthenticationTransaction(db, {
        stateHash: "expired",
        expiresAt: 4_000,
        removeExpiredBefore: 1_000,
      }),
    ).resolves.toBe(true);
    await expect(
      claimSsoAuthenticationTransaction(db, {
        stateHash: "active",
        expiresAt: 4_000,
        removeExpiredBefore: 1_000,
      }),
    ).resolves.toBe(false);
  });
});
