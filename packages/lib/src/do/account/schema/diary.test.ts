import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { accountSchema as schema } from "../database";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle-do-account") });
  return db;
}

describe("Diary chat D1 schema", () => {
  it("同じAccountにactive Sessionを2件作れない", () => {
    const db = createTestDb();
    db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" }).run();
    const values = {
      accountId: "account-1",
      status: "active" as const,
      startedAt: new Date(0),
      lastUserMessageAt: new Date(0),
    };
    db.insert(schema.conversationSessions)
      .values({ id: "session-1", ...values })
      .run();
    expect(db.select().from(schema.conversationSessions).get()).toMatchObject({
      conversationPolicyId: "reflective",
      replyOpportunityCount: 0,
      replyCount: 0,
      awaitingReply: false,
    });
    expect(() =>
      db
        .insert(schema.conversationSessions)
        .values({ id: "session-2", ...values })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("LINE eventの会話messageを冪等キーで重複させない", () => {
    const db = createTestDb();
    db.insert(schema.accountDataIdentity).values({ singleton: 1, accountId: "account-1" }).run();
    db.insert(schema.sourceRecords)
      .values({
        id: "source-1",
        accountId: "account-1",
        kind: "user_input",
        originalRef: "line:event-1",
      })
      .run();
    db.insert(schema.conversationSessions)
      .values({
        id: "session-1",
        accountId: "account-1",
        startedAt: new Date(0),
        lastUserMessageAt: new Date(0),
      })
      .run();
    db.insert(schema.conversationMessages)
      .values({
        id: "message-1",
        sessionId: "session-1",
        sequence: 1,
        role: "user",
        sourceRecordId: "source-1",
        channel: "line",
        channelEventId: "event-1",
      })
      .run();
    expect(() =>
      db
        .insert(schema.conversationMessages)
        .values({
          id: "message-2",
          sessionId: "session-1",
          sequence: 2,
          role: "user",
          sourceRecordId: "source-1",
          channel: "line",
          channelEventId: "event-1",
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("AccountData descendantへaccountIdを重複定義しない", () => {
    expect("accountId" in schema.sourceRecordTextPayloads).toBe(false);
    expect("accountId" in schema.conversationMessages).toBe(false);
    expect("accountId" in schema.chatTurns).toBe(false);
    expect("accountId" in schema.diaryBrainCheckpointItems).toBe(false);
  });
});
