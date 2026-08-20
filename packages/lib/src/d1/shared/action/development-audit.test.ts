import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { SharedD1Client } from "../client";
import * as schema from "../schema";
import {
  pruneDevelopmentOperationAudits,
  recordDevelopmentOperationAudit,
} from "./development-audit";

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

describe("development operation audit", () => {
  it("操作種別・結果・件数だけを保存し90日より古い記録を削除する", async () => {
    const db = createTestDb();
    await recordDevelopmentOperationAudit(
      db,
      "account-data-reset",
      8,
      new Date("2026-01-01T00:00:00.000Z"),
    );
    await recordDevelopmentOperationAudit(
      db,
      "brain-vector-bulk-reset",
      3,
      new Date("2026-04-02T00:00:00.000Z"),
    );

    const rows = await db.select().from(schema.developmentOperationAudits).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operation: "brain-vector-bulk-reset",
      result: "succeeded",
      affectedCount: 3,
      createdAt: new Date("2026-04-02T00:00:00.000Z"),
    });
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      ["affectedCount", "createdAt", "id", "operation", "result"].sort(),
    );
  });

  it("定期cleanupで90日より古い記録だけを削除する", async () => {
    const db = createTestDb();
    await recordDevelopmentOperationAudit(
      db,
      "brain-vector-single-reset",
      1,
      new Date("2026-01-01T00:00:00.000Z"),
    );
    await recordDevelopmentOperationAudit(
      db,
      "brain-vector-bulk-reset",
      2,
      new Date("2026-01-03T00:00:00.000Z"),
    );

    await expect(
      pruneDevelopmentOperationAudits(db, new Date("2026-04-02T00:00:00.000Z")),
    ).resolves.toBe(1);
    expect(db.select().from(schema.developmentOperationAudits).all()).toEqual([
      expect.objectContaining({ operation: "brain-vector-bulk-reset" }),
    ]);
  });
});
