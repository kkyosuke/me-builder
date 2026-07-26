import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { D1Client } from "../client";
import * as schema from "../schema";
import { upsertIdentity } from "./account";

function createTestDb(): D1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });

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

describe("upsertIdentity", () => {
  it("should create new account and identity when identity does not exist", async () => {
    const db = createTestDb();
    const result = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "line_user_123",
    });

    expect(result.account.id).toBeDefined();
    expect(result.account.status).toBe("active");
    expect(result.identity.accountId).toBe(result.account.id);
    expect(result.identity.provider).toBe("line");
    expect(result.identity.providerAccountId).toBe("line_user_123");
  });

  it("should update and return existing account and identity on second call", async () => {
    const db = createTestDb();
    const result1 = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "line_user_reuse",
    });

    const result2 = await upsertIdentity(db, {
      provider: "line",
      providerAccountId: "line_user_reuse",
    });

    expect(result2.account.id).toBe(result1.account.id);
    expect(result2.identity.id).toBe(result1.identity.id);
  });
});
