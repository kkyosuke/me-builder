import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import type { D1Client } from "../client";
import * as schema from "../schema";
import { upsertAccountIdentity } from "./account";

function createTestDb(): D1Client {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);
  sqlite.exec(`
    CREATE TABLE account_identities (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE UNIQUE INDEX provider_account_active_idx
    ON account_identities (provider, provider_account_id)
    WHERE is_deleted = 0;
  `);

  const db = drizzle(sqlite, { schema });

  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => {
      const results = [];
      for (const q of queries) {
        results.push(await q);
      }
      return results;
    },
    writable: true,
  });

  return db as unknown as D1Client;
}

describe("upsertAccountIdentity", () => {
  it("should create new account and identity when identity does not exist", async () => {
    const db = createTestDb();
    const result = await upsertAccountIdentity(db, {
      provider: "line",
      providerAccountId: "U12345678",
    });

    expect(result.account.id).toBeDefined();
    expect(result.account.status).toBe("active");
    expect(result.identity.accountId).toBe(result.account.id);
    expect(result.identity.provider).toBe("line");
    expect(result.identity.providerAccountId).toBe("U12345678");
  });

  it("should update and return existing account and identity on second call", async () => {
    const db = createTestDb();
    const res1 = await upsertAccountIdentity(db, {
      provider: "line",
      providerAccountId: "U12345678",
    });

    const res2 = await upsertAccountIdentity(db, {
      provider: "line",
      providerAccountId: "U12345678",
    });

    expect(res2.account.id).toBe(res1.account.id);
    expect(res2.identity.id).toBe(res1.identity.id);
  });
});
