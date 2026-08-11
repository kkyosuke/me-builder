import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { AccountDataDatabase } from "../database";
import { accountSchema as schema } from "../database";
import { closeExpiredSessions } from "./diary";

const HOUR_MS = 60 * 60 * 1000;

function createTestDb(): AccountDataDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle-do-account") });
  return db as unknown as AccountDataDatabase;
}

async function insertSession(
  db: AccountDataDatabase,
  input: Readonly<{ id: string; startedAt: Date; lastUserMessageAt: Date }>,
) {
  await db.insert(schema.conversationSessions).values({
    id: input.id,
    accountId: "account-1",
    status: "active",
    startedAt: input.startedAt,
    lastUserMessageAt: input.lastUserMessageAt,
  });
}

async function closeReasonOf(db: AccountDataDatabase, id: string) {
  return db
    .select({
      status: schema.conversationSessions.status,
      closeReason: schema.conversationSessions.closeReason,
      closedAt: schema.conversationSessions.closedAt,
    })
    .from(schema.conversationSessions)
    .where(eq(schema.conversationSessions.id, id))
    .get();
}

/** AccountDataのalarmが呼ぶ期限切れSession終了。 */
describe("closeExpiredSessions", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");

  // active Sessionは1 Accountに1件までなので、期限ごとに別のObjectで確認する。
  it("開始から最大待機を超えたSessionをhard_capで閉じる", async () => {
    const db = createTestDb();
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });
    await insertSession(db, {
      id: "hard-cap",
      startedAt: new Date(now.getTime() - 25 * HOUR_MS),
      lastUserMessageAt: new Date(now.getTime() - 1 * HOUR_MS),
    });

    await expect(closeExpiredSessions(db, now)).resolves.toBe(1);
    await expect(closeReasonOf(db, "hard-cap")).resolves.toMatchObject({
      status: "closed",
      closeReason: "hard_cap",
      closedAt: now,
    });
  });

  it("最終発言から無操作期限を超えたSessionをinactiveで閉じる", async () => {
    const db = createTestDb();
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });
    await insertSession(db, {
      id: "inactive",
      startedAt: new Date(now.getTime() - 8 * HOUR_MS),
      lastUserMessageAt: new Date(now.getTime() - 7 * HOUR_MS),
    });

    await expect(closeExpiredSessions(db, now)).resolves.toBe(1);
    await expect(closeReasonOf(db, "inactive")).resolves.toMatchObject({
      status: "closed",
      closeReason: "inactive",
      closedAt: now,
    });
  });

  it("期限内のactive Sessionを閉じず、再実行しても数えない", async () => {
    const db = createTestDb();
    await db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" });
    await insertSession(db, {
      id: "fresh",
      startedAt: new Date(now.getTime() - 1 * HOUR_MS),
      lastUserMessageAt: new Date(now.getTime() - 1 * HOUR_MS),
    });

    await expect(closeExpiredSessions(db, now)).resolves.toBe(0);
    await expect(closeReasonOf(db, "fresh")).resolves.toMatchObject({ status: "active" });
    await expect(closeExpiredSessions(db, now)).resolves.toBe(0);
  });
});
