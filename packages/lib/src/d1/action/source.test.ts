import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { D1Client } from "../client";
import * as schema from "../schema";
import { hasActiveSourceRecords } from "./source";

function createTestDb(): D1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  return db as unknown as D1Client;
}

describe("hasActiveSourceRecords", () => {
  it("本人の有効な記録だけを判定する", async () => {
    const db = createTestDb();
    await db.insert(schema.accounts).values([{ id: "account-1" }, { id: "account-2" }]);
    await db.insert(schema.sourceRecords).values([
      { id: "active", accountId: "account-1", kind: "user_input" },
      { id: "deleted", accountId: "account-2", kind: "user_input", isDeleted: true },
    ]);

    await expect(hasActiveSourceRecords(db, "account-1")).resolves.toBe(true);
    await expect(hasActiveSourceRecords(db, "account-2")).resolves.toBe(false);
    await expect(hasActiveSourceRecords(db, "unknown")).resolves.toBe(false);
  });
});
