import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
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

describe("Diary chat D1 schema", () => {
  it("同じAccountにactive Sessionを2件作れない", () => {
    const db = createTestDb();
    db.insert(schema.accounts).values({ id: "account-1" }).run();
    const values = {
      accountId: "account-1",
      status: "active" as const,
      startedAt: new Date(0),
      lastUserMessageAt: new Date(0),
    };
    db.insert(schema.conversationSessions)
      .values({ id: "session-1", ...values })
      .run();
    expect(() =>
      db
        .insert(schema.conversationSessions)
        .values({ id: "session-2", ...values })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("LINE eventの会話messageを冪等キーで重複させない", () => {
    const db = createTestDb();
    db.insert(schema.accounts).values({ id: "account-1" }).run();
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
        accountId: "account-1",
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
          accountId: "account-1",
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

  it("別AccountのSource RecordをConversationへ混在させない", () => {
    const db = createTestDb();
    db.insert(schema.accounts)
      .values([{ id: "account-1" }, { id: "account-2" }])
      .run();
    db.insert(schema.sourceRecords)
      .values({ id: "source-2", accountId: "account-2", kind: "user_input" })
      .run();
    db.insert(schema.conversationSessions)
      .values({
        id: "session-1",
        accountId: "account-1",
        startedAt: new Date(0),
        lastUserMessageAt: new Date(0),
      })
      .run();

    expect(() =>
      db
        .insert(schema.conversationMessages)
        .values({
          id: "cross-account-message",
          accountId: "account-1",
          sessionId: "session-1",
          sequence: 1,
          role: "user",
          sourceRecordId: "source-2",
          channel: "line",
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("MessageとTurnの循環参照でも別Accountを結べない", () => {
    const db = createTestDb();
    db.insert(schema.accounts)
      .values([{ id: "account-1" }, { id: "account-2" }])
      .run();
    for (const accountId of ["account-1", "account-2"]) {
      db.insert(schema.conversationSessions)
        .values({
          id: `session-${accountId}`,
          accountId,
          startedAt: new Date(0),
          lastUserMessageAt: new Date(0),
        })
        .run();
      db.insert(schema.chatTurns)
        .values({
          id: `turn-${accountId}`,
          accountId,
          sessionId: `session-${accountId}`,
          fromSequence: 1,
          throughSequence: 1,
          generationEpoch: 1,
          promptVersion: "v1",
          model: "model",
          receivedAt: new Date(0),
        })
        .run();
    }
    db.insert(schema.conversationMessages)
      .values({
        id: "message-account-2",
        accountId: "account-2",
        sessionId: "session-account-2",
        sequence: 1,
        role: "assistant",
        assistantBody: "応答",
        channel: "line",
        turnId: "turn-account-2",
      })
      .run();

    expect(() =>
      db
        .update(schema.chatTurns)
        .set({ responseMessageId: "message-account-2" })
        .where(eq(schema.chatTurns.id, "turn-account-1"))
        .run(),
    ).toThrow(/account boundary violation/);
    expect(() =>
      db
        .insert(schema.conversationMessages)
        .values({
          id: "message-cross-turn",
          accountId: "account-1",
          sessionId: "session-account-1",
          sequence: 1,
          role: "assistant",
          assistantBody: "応答",
          channel: "line",
          turnId: "turn-account-2",
        })
        .run(),
    ).toThrow(/account boundary violation/);
  });
});
