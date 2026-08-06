import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { D1Client } from "../client";
import * as schema from "../schema";
import { purgeExpiredConversationBodies } from "./conversation";

function createTestDb(): D1Client {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  // biome-ignore lint/suspicious/noExplicitAny: D1互換adapterへmigrationを適用する
  migrate(db as any, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  Object.defineProperty(db, "batch", {
    value: async (queries: readonly unknown[]) => Promise.all(queries),
    writable: true,
  });
  return db as unknown as D1Client;
}

describe("purgeExpiredConversationBodies", () => {
  it("100件を超える本文を複数回に分けて最後まで削除できる", async () => {
    const db = createTestDb();
    const old = new Date("2025-01-01T00:00:00Z");
    await db.insert(schema.accounts).values({ id: "account" });
    await db.insert(schema.conversationSessions).values({
      id: "session",
      accountId: "account",
      status: "closed",
      startedAt: old,
      lastUserMessageAt: old,
      hardCloseAt: old,
      closedAt: old,
      closeReason: "inactive",
      nextSequence: 102,
    });
    await db.insert(schema.conversationMessages).values(
      Array.from({ length: 101 }, (_, index) => ({
        id: `message-${index}`,
        sessionId: "session",
        sequence: index + 1,
        role: "assistant" as const,
        kind: "message" as const,
        assistantBody: `body-${index}`,
        channel: "line",
        createdAt: old,
        updatedAt: old,
      })),
    );

    const now = new Date("2025-01-03T00:00:01Z");
    await expect(purgeExpiredConversationBodies(db, now)).resolves.toBe(100);
    await expect(purgeExpiredConversationBodies(db, now)).resolves.toBe(1);
    await expect(purgeExpiredConversationBodies(db, now)).resolves.toBe(0);
  });
});
