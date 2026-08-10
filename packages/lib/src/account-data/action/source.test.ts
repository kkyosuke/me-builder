import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountDataSchema as schema } from "../database";
import { hasActiveSourceRecords } from "./source";

function createTestDb(): AccountDataDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle-account-data") });
  return db as unknown as AccountDataDatabase;
}

describe("hasActiveSourceRecords", () => {
  it("有効な記録だけを判定する", async () => {
    const db = createTestDb();
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });
    await db.insert(schema.sourceRecords).values([
      { id: "active", accountId: "account-1", kind: "user_input" },
      { id: "deleted", accountId: "account-1", kind: "user_input", isDeleted: true },
    ]);

    await expect(hasActiveSourceRecords(db, "account-1")).resolves.toBe(true);
    await expect(hasActiveSourceRecords(db, "unknown")).resolves.toBe(false);
  });
});

describe("source records", () => {
  it("Objectに固定したAccount以外のSource Recordを保存できない", async () => {
    const db = createTestDb();
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });

    await expect(
      db
        .insert(schema.sourceRecords)
        .values({ id: "foreign", accountId: "account-2", kind: "user_input" }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });
});
