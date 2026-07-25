import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { D1Client } from "../client";
import * as schema from "../schema";
import { accounts } from "../schema/account";
import { softDelete } from "./common";

function createTestDb(): D1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  migrate(db as any, { migrationsFolder: "./drizzle" });
  return db as unknown as D1Client;
}

describe("softDelete common action", () => {
  it("should soft delete a record by setting isDeleted and deletedAt", async () => {
    const db = createTestDb();
    const now = new Date();
    await db.insert(accounts).values({
      id: "acc-soft-delete-1",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await softDelete(db, accounts, "acc-soft-delete-1");

    const record = await db.query.accounts.findFirst({
      where: (table, { eq }) => eq(table.id, "acc-soft-delete-1"),
    });

    expect(record).toBeDefined();
    expect(record?.isDeleted).toBe(true);
    expect(record?.deletedAt).toBeDefined();
  });
});
