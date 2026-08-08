import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "./index";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  return db;
}

describe("Source D1 schema", () => {
  it("Source Recordと改訂エッジを保存する", () => {
    const db = createTestDb();
    db.insert(schema.accounts).values({ id: "account-1" }).run();
    db.insert(schema.sourceRecords)
      .values([
        { id: "source-v1", accountId: "account-1", kind: "user_input" },
        { id: "source-v2", accountId: "account-1", kind: "user_input" },
      ])
      .run();
    db.insert(schema.sourceRecordRevisions)
      .values({
        id: "revision-1",
        previousSourceRecordId: "source-v1",
        nextSourceRecordId: "source-v2",
        derivationMethod: "deterministic",
      })
      .run();

    expect(db.select().from(schema.sourceRecordRevisions).all()).toHaveLength(1);
  });

  it("存在しないSource Recordへの改訂エッジを拒否する", () => {
    const db = createTestDb();

    expect(() =>
      db
        .insert(schema.sourceRecordRevisions)
        .values({
          id: "revision-invalid",
          previousSourceRecordId: "missing-v1",
          nextSourceRecordId: "missing-v2",
          derivationMethod: "deterministic",
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("Source Recordと1対1のテキスト原本を保存する", () => {
    const db = createTestDb();
    db.insert(schema.accounts).values({ id: "account-1" }).run();
    db.insert(schema.sourceRecords)
      .values({ id: "source-1", accountId: "account-1", kind: "user_input" })
      .run();
    db.insert(schema.sourceRecordTextPayloads)
      .values({
        sourceRecordId: "source-1",
        body: "日記本文",
        contentHash: "sha256",
      })
      .run();
    expect(db.select().from(schema.sourceRecordTextPayloads).get()?.body).toBe("日記本文");
  });

  it("Source descendantへaccountIdを重複定義しない", () => {
    expect("accountId" in schema.sourceRecordRevisions).toBe(false);
    expect("accountId" in schema.sourceRecordTextPayloads).toBe(false);
  });
});
